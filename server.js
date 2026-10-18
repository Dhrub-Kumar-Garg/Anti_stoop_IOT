const express = require('express');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { Server } = require('socket.io');
const WebSocket = require('ws');
const STALE_MS = 5000;

function normalizePacket(input) {
    if (!input || !Number.isInteger(input.flex1) || !Number.isInteger(input.flex2)
        || input.flex1 < 0 || input.flex1 > 4095 || input.flex2 < 0 || input.flex2 > 4095
        || typeof input.alert_active !== 'boolean') return null;
    const packet = { flex1: input.flex1, flex2: input.flex2, alert_active: input.alert_active };
    for (const key of ['calibrating', 'motor_test', 'motor_active']) {
        if (typeof input[key] === 'boolean') packet[key] = input[key];
    }
    if (Number.isSafeInteger(input.calibration_id) && input.calibration_id >= 0) packet.calibration_id = input.calibration_id;
    if (Number.isSafeInteger(input.alert_delay_ms) && input.alert_delay_ms >= 0) packet.alert_delay_ms = input.alert_delay_ms;
    if (Number.isInteger(input.baseline1) && input.baseline1 >= 0 && input.baseline1 <= 4095
        && Number.isInteger(input.baseline2) && input.baseline2 >= 0 && input.baseline2 <= 4095
        && Number.isInteger(input.threshold) && input.threshold > 0 && input.threshold <= 4095) {
        Object.assign(packet, {
            baseline1: input.baseline1, baseline2: input.baseline2, threshold: input.threshold,
            bending: Math.abs(input.flex1 - input.baseline1) > input.threshold
                || Math.abs(input.flex2 - input.baseline2) > input.threshold,
        });
    }
    return packet;
}

function createBridge() {
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server);
    const wss = new WebSocket.Server({ noServer: true, maxPayload: 2048 });
    app.use(express.static(path.join(__dirname, 'public')));
    let hardware = null;
    let latest = null;
    let simulation = null;
    let demoStep = 0;
    const status = () => ({
        connected: hardware?.readyState === WebSocket.OPEN || false,
        simulated: Boolean(simulation),
        fresh: Boolean(latest && Date.now() - latest.received_at < STALE_MS),
        last_seen: latest?.received_at ?? null,
    });
    const broadcastStatus = () => io.emit('hardware_status', status());
    function publish(packet, simulated) {
        latest = { ...packet, simulated, received_at: Date.now() };
        io.emit('esp32_data', latest);
    }
    function stopSimulation() {
        if (!simulation) return;
        clearInterval(simulation);
        simulation = null;
        latest = null;
        io.emit('sim_status', { running: false });
        broadcastStatus();
    }
    function startSimulation() {
        if (hardware) return false;
        if (simulation) return true;
        demoStep = 0;
        let bendingSince = null;
        const tick = () => {
            const wave = (Math.sin(demoStep++ / 12) + 1) / 2;
            const flex1 = Math.round(1800 + wave * 180);
            const flex2 = Math.round(1900 + wave * 140);
            const bending = flex1 - 1800 > 100 || flex2 - 1900 > 100;
            bendingSince = bending ? (bendingSince ?? Date.now()) : null;
            publish({ flex1, flex2, baseline1: 1800, baseline2: 1900, threshold: 100, alert_delay_ms: 1000,
                bending, alert_active: bendingSince !== null && Date.now() - bendingSince >= 1000 }, true);
        };
        simulation = setInterval(tick, 500);
        tick();
        io.emit('sim_status', { running: true });
        broadcastStatus();
        return true;
    }
    server.on('upgrade', (request, socket, head) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        if (pathname.startsWith('/socket.io/')) return;
        if (pathname !== '/' && pathname !== '/esp32') return socket.destroy();
        wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
    });
    wss.on('connection', ws => {
        if (hardware) return ws.close(1008, 'One vest is already connected');
        if (simulation) stopSimulation();
        hardware = ws;
        latest = null;
        ws.alive = true;
        broadcastStatus();
        ws.on('pong', () => { ws.alive = true; });
        ws.on('message', message => {
            try {
                const packet = normalizePacket(JSON.parse(message.toString()));
                if (packet) publish(packet, false);
            } catch { /* Ignore malformed frames without logging untrusted contents. */ }
        });
        ws.on('error', () => {});
        ws.on('close', () => {
            if (hardware !== ws) return;
            hardware = null;
            latest = null;
            broadcastStatus();
        });
    });
    const heartbeat = setInterval(() => {
        if (hardware) {
            if (!hardware.alive) hardware.terminate();
            else { hardware.alive = false; hardware.ping(); }
        }
        broadcastStatus();
    }, 3000);
    heartbeat.unref();
    app.get('/api/status', (req, res) => res.json(status()));
    io.on('connection', socket => {
        socket.emit('hardware_status', status());
        if (latest && status().fresh) socket.emit('esp32_data', latest);
        socket.on('toggle_simulation', (enable, acknowledge) => {
            if (typeof enable !== 'boolean') return;
            const ok = enable ? startSimulation() : (stopSimulation(), true);
            if (typeof acknowledge === 'function') acknowledge({ ok, message: ok ? '' : 'Disconnect the vest before starting a demo.' });
        });

    });
    async function close() {
        clearInterval(heartbeat);
        clearInterval(simulation);
        for (const client of wss.clients) client.terminate();
        await new Promise(resolve => io.close(resolve));
        wss.close();
    }
    return { app, server, close };
}
if (require.main === module) {
    const { server } = createBridge();
    const port = Number(process.env.PORT) || 5000;
    server.on('error', error => {
        console.error(error.code === 'EADDRINUSE'
            ? `Port ${port} is occupied. Choose another port, for example: PORT=5001 npm start (update the ESP32 port too).`
            : `Cannot start dashboard: ${error.message}`);
        process.exitCode = 1;
    });
    server.listen(port, '0.0.0.0', () => {
        const ip = Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address ?? 'localhost';
        console.log(`PosturePal: http://localhost:${port}`);
        console.log(`Network dashboard: http://${ip}:${port}`);
        console.log(`ESP32 endpoint: ws://${ip}:${port}/`);
    });
}
module.exports = { createBridge, normalizePacket };
