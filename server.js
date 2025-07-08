const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path'); // Import path module for serving static files

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Render automatically provides the PORT environment variable
const PORT = process.env.PORT || 10000;

// Serve static files (like index.html) from the current directory.
// This is crucial for serving your frontend files.
app.use(express.static(path.join(__dirname)));

// Explicitly serve index.html for the root route.
// This ensures that when someone visits your Render URL, they get the game's HTML.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Store active rooms and their players
const rooms = {};

// AI Antakshari Logic (simplified for this example)
const hindiLetters = ['अ', 'आ', 'इ', 'ई', 'उ', 'ऊ', 'ए', 'ऐ', 'ओ', 'औ', 'क', 'ख', 'ग', 'घ', 'च', 'छ', 'ज', 'झ', 'ट', 'ठ', 'ड', 'ढ', 'त', 'थ', 'द', 'ध', 'न', 'प', 'फ', 'ब', 'भ', 'म', 'य', 'र', 'ल', 'व', 'श', 'ष', 'स', 'ह'];

/**
 * Generates a unique 4-character alphanumeric room code.
 * @returns {string} The generated room code.
 */
function generateRoomCode() {
    let code = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < 4; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Handle creating a room
    socket.on('createRoom', (username) => {
        let roomCode = generateRoomCode();
        // Ensure the generated room code is unique
        while (rooms[roomCode]) {
            roomCode = generateRoomCode();
        }
        rooms[roomCode] = {
            players: [{ id: socket.id, username: username, score: 0 }],
            hostId: socket.id,
            gameStarted: false,
            currentTurnIndex: 0,
            currentLetter: '',
            timer: null,
            maxPlayers: 4 // Set max players for Antakshari
        };
        socket.join(roomCode); // Add the socket to the room
        socket.emit('roomCreated', roomCode); // Notify the creator of the room code
        console.log(`Room ${roomCode} created by ${username} (${socket.id})`);
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players); // Update all players in the room
    });

    // Handle joining a room
    socket.on('joinRoom', (roomCode, username) => {
        const room = rooms[roomCode];
        if (!room) {
            socket.emit('roomNotFound');
            return;
        }
        if (room.players.length >= room.maxPlayers) {
            socket.emit('roomFull');
            return;
        }
        if (room.gameStarted) {
            socket.emit('gameAlreadyStarted');
            return;
        }

        socket.join(roomCode); // Add the joining socket to the room
        room.players.push({ id: socket.id, username: username, score: 0 }); // Add new player to room's player list
        socket.emit('roomJoined', roomCode); // Notify the joining player they've joined
        console.log(`${username} (${socket.id}) joined room ${roomCode}`);
        io.to(roomCode).emit('updatePlayers', room.players); // Update all players with the new player list
        // Inform new player about current game state if game hasn't started
        if (!room.gameStarted) {
            io.to(roomCode).emit('aiMessage', `${username} has joined the room.`);
        }
    });

    // Handle starting the game
    socket.on('startGame', (roomCode) => {
        const room = rooms[roomCode];
        // Ensure room exists, only host can start, and game is not already started
        if (!room || room.hostId !== socket.id || room.gameStarted) {
            return;
        }

        room.gameStarted = true;
        room.currentTurnIndex = 0; // Start with the first player
        room.currentLetter = hindiLetters[Math.floor(Math.random() * hindiLetters.length)]; // Pick a random starting letter
        io.to(roomCode).emit('gameStarted', room.currentLetter, room.players[room.currentTurnIndex].id);
        io.to(roomCode).emit('aiMessage', `Game started! First letter is '${room.currentLetter}'. ${room.players[room.currentTurnIndex].username}'s turn.`);
        startTurnTimer(roomCode); // Start the timer for the first turn
    });

    // Handle AI judge decision (Correct/Wrong)
    socket.on('aiDecision', (roomCode, playerId, decision) => {
        const room = rooms[roomCode];
        // Ensure room exists, game is started, and decision is for the current player
        if (!room || !room.gameStarted || room.players[room.currentTurnIndex].id !== playerId) {
            return;
        }

        clearTimeout(room.timer); // Stop the current timer as a decision has been made

        const currentPlayer = room.players.find(p => p.id === playerId);
        if (decision === 'correct') {
            currentPlayer.score += 10; // Award points for correct song
            room.currentLetter = hindiLetters[Math.floor(Math.random() * hindiLetters.length)]; // Get a new letter
            io.to(roomCode).emit('aiMessage', `${currentPlayer.username} sang correctly! New letter is '${room.currentLetter}'.`);
        } else {
            io.to(roomCode).emit('aiMessage', `${currentPlayer.username} was wrong or ran out of time.`);
        }
        io.to(roomCode).emit('updatePlayers', room.players); // Update scores for all players

        // Move to the next player's turn
        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        io.to(roomCode).emit('nextTurn', room.currentLetter, room.players[room.currentTurnIndex].id);
        io.to(roomCode).emit('aiMessage', `${room.players[room.currentTurnIndex].username}'s turn.`);
        startTurnTimer(roomCode); // Start timer for the next turn
    });

    /**
     * Starts a 30-second timer for the current player's turn.
     * If the timer runs out, the player's turn is automatically marked as 'wrong'.
     * @param {string} roomCode - The code of the room where the game is being played.
     */
    function startTurnTimer(roomCode) {
        const room = rooms[roomCode];
        if (room.timer) clearTimeout(room.timer); // Clear any existing timer to prevent multiple timers

        let timeLeft = 30;
        io.to(roomCode).emit('timerUpdate', timeLeft); // Send initial timer value to clients

        room.timer = setInterval(() => {
            timeLeft--;
            io.to(roomCode).emit('timerUpdate', timeLeft); // Send updated timer value
            if (timeLeft <= 0) {
                clearInterval(room.timer); // Stop the timer when it reaches zero
                // Automatically mark as wrong if timer runs out
                io.to(roomCode).emit('aiDecision', room.players[room.currentTurnIndex].id, 'wrong');
            }
        }, 1000); // Update every second
    }

    // Handle WebRTC signaling for peer-to-peer connections
    // Offers (from initiating peer)
    socket.on('offer', (roomCode, offer) => {
        // Broadcast the offer to other clients in the same room (excluding sender)
        socket.to(roomCode).emit('offer', socket.id, offer);
    });

    // Answers (from receiving peer in response to an offer)
    socket.on('answer', (roomCode, answer) => {
        // Broadcast the answer to other clients in the same room (excluding sender)
        socket.to(roomCode).emit('answer', socket.id, answer);
    });

    // ICE Candidates (network information for establishing direct connection)
    socket.on('candidate', (roomCode, candidate) => {
        // Broadcast the candidate to other clients in the same room (excluding sender)
        socket.to(roomCode).emit('candidate', socket.id, candidate);
    });

    // Handle disconnection of a user
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Iterate through all rooms to find the disconnected user
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);

            if (playerIndex !== -1) {
                const disconnectedPlayer = room.players[playerIndex];
                room.players.splice(playerIndex, 1); // Remove the player from the room
                io.to(roomCode).emit('updatePlayers', room.players); // Update player list for remaining players
                io.to(roomCode).emit('aiMessage', `${disconnectedPlayer.username} has left the room.`);

                // If the host leaves, assign a new host or delete the room
                if (room.hostId === socket.id) {
                    if (room.players.length > 0) {
                        room.hostId = room.players[0].id; // Assign the first remaining player as new host
                        io.to(roomCode).emit('aiMessage', `${room.players[0].username} is now the host.`);
                    } else {
                        // If no players left, clean up the room
                        clearInterval(room.timer); // Stop any active game timer
                        delete rooms[roomCode];
                        console.log(`Room ${roomCode} deleted as all players left.`);
                    }
                }

                // Adjust current turn if the disconnected player was the current player
                if (room.gameStarted && room.players.length > 0) {
                    // If the current turn index is now out of bounds or points to the disconnected player,
                    // move to the next valid player.
                    if (room.currentTurnIndex >= room.players.length || room.players[room.currentTurnIndex].id === disconnectedPlayer.id) {
                        room.currentTurnIndex = room.currentTurnIndex % room.players.length; // Wrap around if needed
                        io.to(roomCode).emit('nextTurn', room.currentLetter, room.players[room.currentTurnIndex].id);
                        io.to(roomCode).emit('aiMessage', `${room.players[room.currentTurnIndex].username}'s turn.`);
                        startTurnTimer(roomCode); // Restart timer for the new current player
                    }
                } else if (room.gameStarted && room.players.length === 0) {
                    // If game was started and no players left, stop the game
                    room.gameStarted = false;
                    clearInterval(room.timer);
                }
                break; // Exit loop once the player is found and handled
            }
        }
    });
});

// Start the server and listen on the specified port
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
