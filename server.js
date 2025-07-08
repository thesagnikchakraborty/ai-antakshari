// server.js
// This is the backend for the AI Antakshari game.
// It uses Node.js, Express, and Socket.IO.

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity. For production, restrict this.
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 10000;

// --- Data Structures ---
let rooms = {}; // Stores all game rooms

// --- Game Constants ---
const HINDI_CONSONANTS = ["क", "ख", "ग", "घ", "च", "छ", "ज", "झ", "ट", "ठ", "ड", "ढ", "ण", "त", "थ", "द", "ध", "न", "प", "फ", "ब", "भ", "म", "य", "र", "ल", "व", "श", "ष", "स", "ह"];
const TIME_LIMIT = 30; // seconds

// --- Helper Functions ---
function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (rooms[code]);
    return code;
}

// --- Socket.IO Connection Logic ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id} with username ${socket.handshake.query.username}`);

    // Room Management
    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            players: [],
            gameState: createInitialGameState()
        };
        joinRoom(roomCode);
    });

    socket.on('joinRoom', (roomCode) => {
        if (!rooms[roomCode]) {
            socket.emit('joinError', 'Room not found.');
            return;
        }
        if (rooms[roomCode].players.length >= 4) {
            socket.emit('joinError', 'Room is full.');
            return;
        }
        joinRoom(roomCode);
    });

    const joinRoom = (roomCode) => {
        socket.join(roomCode);
        const player = {
            id: socket.id,
            username: socket.handshake.query.username,
            score: 0
        };
        rooms[roomCode].players.push(player);
        socket.data.roomCode = roomCode;

        // Notify the new user they've joined
        socket.emit(rooms[roomCode].players.length === 1 ? 'roomCreated' : 'joinedRoom', roomCode);

        // Notify existing users in the room about the new player
        const otherPlayers = rooms[roomCode].players.filter(p => p.id !== socket.id);
        otherPlayers.forEach(p => socket.to(p.id).emit('userJoined', player));

        // Send the full player list to everyone in the room
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
        io.to(roomCode).emit('updateGameState', rooms[roomCode].gameState);
    };

    // WebRTC Signaling
    socket.on('signal', (data) => {
        // Relay signal to the specific user
        io.to(data.to).emit('signal', {
            from: data.from,
            sdp: data.sdp,
            candidate: data.candidate
        });
    });

    // Game Logic
    socket.on('startGame', () => {
        const roomCode = socket.data.roomCode;
        if (!roomCode || !rooms[roomCode]) return;

        // Only the host (first player) can start
        if (rooms[roomCode].players[0].id !== socket.id) return;

        const room = rooms[roomCode];
        if (room.gameState.isGameRunning) return;

        // Reset scores
        room.players.forEach(p => p.score = 0);

        room.gameState.isGameRunning = true;
        room.gameState.currentPlayerIndex = 0;
        room.gameState.currentPlayerId = room.players[0].id;
        room.gameState.currentLetter = HINDI_CONSONANTS[Math.floor(Math.random() * HINDI_CONSONANTS.length)];
        room.gameState.status = "Game in Progress";
        
        startTurn(roomCode);
    });
    
    // Disconnect Logic
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const roomCode = socket.data.roomCode;
        if (!roomCode || !rooms[roomCode]) return;

        const room = rooms[roomCode];
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex > -1) {
            room.players.splice(playerIndex, 1);
            
            // If the game was running and the current player left, move to the next turn
            if(room.gameState.isGameRunning && room.gameState.currentPlayerIndex === playerIndex) {
                // Adjust index if needed
                if(room.gameState.currentPlayerIndex >= room.players.length) {
                    room.gameState.currentPlayerIndex = 0;
                }
                nextTurn(roomCode);
            }

            // If room is empty, delete it
            if (room.players.length === 0) {
                delete rooms[roomCode];
                console.log(`Room ${roomCode} deleted.`);
            } else {
                // If host left, assign new host
                // For simplicity, we don't implement this here, but in a real app you would.
                
                // Notify others
                io.to(roomCode).emit('userLeft', socket.id);
                io.to(roomCode).emit('updatePlayers', room.players);
                io.to(roomCode).emit('updateGameState', room.gameState);
            }
        }
    });
});

// --- Game Logic Functions ---
function createInitialGameState() {
    return {
        isGameRunning: false,
        status: 'Waiting for players...',
        aiMessage: 'Waiting for host to start...',
        currentPlayerIndex: -1,
        currentPlayerId: null,
        currentLetter: '-',
        isTimerRunning: false,
        timeLimit: TIME_LIMIT,
        timerId: null,
        players: [] // This will be populated from the room
    };
}

function startTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.gameState.isGameRunning || room.players.length === 0) return;

    clearTimeout(room.gameState.timerId);

    const currentPlayer = room.players[room.gameState.currentPlayerIndex];
    room.gameState.currentPlayerId = currentPlayer.id;
    room.gameState.aiMessage = `It's ${currentPlayer.username}'s turn! Sing from '${room.gameState.currentLetter}'.`;
    room.gameState.isTimerRunning = true;

    io.to(roomCode).emit('updateGameState', { ...room.gameState, players: room.players });

    // AI JUDGE SIMULATION: In a real app, you'd analyze audio. Here we use a timer.
    // We'll simulate a correct answer after 10 seconds for demo purposes.
    room.gameState.timerId = setTimeout(() => {
        // If the timer runs out, it's an incorrect answer (timeout)
        handleTurnResult(roomCode, false, "Time's up!");
    }, TIME_LIMIT * 1000);
    
    // For this demo, let's add a "correct" and "wrong" button to the host's UI in a real app.
    // Here, we'll just simulate a correct answer after a delay.
    // NOTE: This is a placeholder for real AI logic.
    // To make it interactive, you'd have the client emit an event like 'songSung'
    // and the AI would process it. For now, we'll just cycle turns.
}

function handleTurnResult(roomCode, isCorrect, reason) {
    const room = rooms[roomCode];
    if (!room || !room.gameState.isGameRunning) return;

    const currentPlayer = room.players[room.gameState.currentPlayerIndex];

    if (isCorrect) {
        currentPlayer.score += 10;
        room.gameState.currentLetter = HINDI_CONSONANTS[Math.floor(Math.random() * HINDI_CONSONANTS.length)];
        room.gameState.aiMessage = `Correct, ${currentPlayer.username}! +10 points. Next letter is '${room.gameState.currentLetter}'.`;
    } else {
        room.gameState.aiMessage = `${reason}, ${currentPlayer.username}. No points. Same letter for the next player.`;
    }
    
    nextTurn(roomCode);
}

function nextTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room || !room.gameState.isGameRunning || room.players.length === 0) {
        // Stop the game if no players are left
        if(room) {
            room.gameState = createInitialGameState();
            io.to(roomCode).emit('updateGameState', room.gameState);
        }
        return;
    }

    clearTimeout(room.gameState.timerId);
    room.gameState.isTimerRunning = false;
    
    // Move to the next player
    room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % room.players.length;

    io.to(roomCode).emit('updateGameState', { ...room.gameState, players: room.players });

    // Start the next turn after a short delay
    setTimeout(() => startTurn(roomCode), 3000);
}


// --- Start Server ---
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
