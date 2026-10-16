const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

// Serve static frontend files (index.html)
app.use(express.static(__dirname));

// Socket.io for sending data to the Vanilla HTML UI
const io = new Server(server, { cors: { origin: "*" } });

// Native WebSocket server for catching data from the ESP32
// Using noServer: true so it doesn't collide with Socket.IO upgrades
const wss = new WebSocket.Server({ noServer: true });

// Route HTTP upgrades: let Socket.io handle /socket.io/, route everything else to ESP32 wss
server.on('upgrade', (request, socket, head) => {
    if (request.url.startsWith('/socket.io/')) {
        return; // Handled by Socket.io
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

let esp32Connected = false;
let simInterval = null;

wss.on('connection', (ws) => {
    esp32Connected = true;
    console.log('ESP32 Hardware Connected via Wi-Fi!');
    io.emit('hardware_status', { connected: true });
    
    ws.on('message', (message) => {
        try {
            const sensorData = JSON.parse(message);
            io.emit('esp32_data', sensorData);
        } catch (e) {
            console.error("Invalid JSON received from ESP32:", message.toString());
        }
    });

    ws.on('error', (err) => {
        console.error('ESP32 WebSocket error:', err.message);
    });

    ws.on('close', () => {
        esp32Connected = false;
        console.log('ESP32 Hardware Disconnected');
        io.emit('hardware_status', { connected: false });
    });
});

wss.on('error', (err) => {
    console.error('WebSocket Server error:', err.message);
});

// Helper simulation generator for testing without hardware
function startSimulation() {
    if (simInterval) return;
    let angle = 0;
    simInterval = setInterval(() => {
        angle += 0.25;
        const flex1 = Math.round(50 + 30 * Math.sin(angle) + (Math.random() * 6 - 3));
        const flex2 = Math.round(45 + 25 * Math.sin(angle + 0.6) + (Math.random() * 6 - 3));
        const alert_active = flex1 > 72 || flex2 > 65;
        io.emit('esp32_data', { flex1, flex2, alert_active, simulated: true });
    }, 1000);
}

function stopSimulation() {
    if (simInterval) {
        clearInterval(simInterval);
        simInterval = null;
    }
}

// REST simulation endpoints
app.get('/simulate/start', (req, res) => {
    startSimulation();
    res.json({ status: 'simulation started' });
});

app.get('/simulate/stop', (req, res) => {
    stopSimulation();
    res.json({ status: 'simulation stopped' });
});

io.on('connection', (socket) => {
    console.log('Web Dashboard Connected!');
    socket.emit('hardware_status', { connected: esp32Connected, simulated: !!simInterval });

    socket.on('toggle_simulation', (enable) => {
        if (enable) {
            startSimulation();
            io.emit('sim_status', { running: true });
        } else {
            stopSimulation();
            io.emit('sim_status', { running: false });
        }
    });
});

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const PORT = 5000;
server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log(`Backend Bridge running!`);
    console.log(`  Local Dashboard:    http://localhost:${PORT}`);
    console.log(`  Network Dashboard:  http://${localIP}:${PORT}`);
    console.log(`  ESP32 WebSocket:    ws://${localIP}:${PORT}/`);
});