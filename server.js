/**
 * Combat Zone - Multiplayer WebSocket Server
 * v3.0 - С полной отладкой, CORS и уникальным ID инстанса
 */

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

// Уникальный ID этого инстанса сервера (для отладки Railway)
const INSTANCE_ID = 'srv_' + Math.random().toString(36).substr(2, 6);
console.log(`\n🔷 Instance ID: ${INSTANCE_ID}\n`);

// CORS headers для HTTP
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

// HTTP сервер
const server = http.createServer((req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }
    
    const headers = { ...corsHeaders, 'Content-Type': 'application/json' };
    
    if (req.url === '/health' || req.url === '/api/status') {
        res.writeHead(200, headers);
        res.end(JSON.stringify({ 
            status: 'ok',
            instanceId: INSTANCE_ID,
            players: Object.keys(players).length,
            playerNames: Object.values(players).map(p => p.name),
            connections: wss.clients.size,
            uptime: process.uptime(),
            timestamp: Date.now()
        }));
    } else if (req.url === '/api/players') {
        res.writeHead(200, headers);
        res.end(JSON.stringify({
            count: Object.keys(players).length,
            players: Object.values(players).map(p => ({
                id: p.id,
                name: p.name,
                kills: p.kills,
                deaths: p.deaths
            }))
        }));
    } else {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'text/html' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>Combat Zone Server</title>
    <meta charset="UTF-8">
    <style>
        body { background: #1a1a2e; color: #fff; font-family: Arial, sans-serif; padding: 40px; }
        h1 { color: #00ff88; }
        .status { background: #16213e; padding: 20px; border-radius: 10px; margin: 20px 0; }
        .online { color: #00ff88; }
        .info { color: #888; margin: 10px 0; }
        code { background: #333; padding: 5px 10px; border-radius: 5px; }
        .players { margin-top: 20px; }
        .player { background: #222; padding: 10px; margin: 5px 0; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>🎮 Combat Zone Game Server</h1>
    <div class="status">
        <p class="online">✅ Сервер запущен и работает</p>
        <p class="info">🔷 Instance ID: <code style="color:#ff0">${INSTANCE_ID}</code></p>
        <p class="info">WebSocket: <code>wss://${req.headers.host || 'your-domain.com'}</code></p>
        <p class="info">Активных игроков: <strong>${Object.keys(players).length}</strong></p>
        <p class="info">WS соединений: <strong>${wss.clients.size}</strong></p>
        <p class="info">Uptime: ${Math.floor(process.uptime())} секунд</p>
    </div>
    <div class="players">
        <h3>Игроки онлайн:</h3>
        ${Object.values(players).map(p => `
            <div class="player">
                <strong>${p.name}</strong> - K: ${p.kills} / D: ${p.deaths}
            </div>
        `).join('') || '<p class="info">Нет активных игроков</p>'}
    </div>
    <script>
        // Auto-refresh every 5 seconds
        setTimeout(() => location.reload(), 5000);
    </script>
</body>
</html>
        `);
    }
});

// WebSocket сервер с CORS
const wss = new WebSocket.Server({ 
    server,
    verifyClient: (info, callback) => {
        // Allow all origins
        callback(true);
    }
});

// Хранилище игроков
const players = {};

// Weapons config
const WEAPONS = {
    ak47: { damage: 25, fireRate: 100 },
    m4a1: { damage: 22, fireRate: 80 },
    awp: { damage: 100, fireRate: 1500 },
    deagle: { damage: 50, fireRate: 300 }
};

function generateId() {
    return 'p_' + Math.random().toString(36).substr(2, 9);
}

function log(type, message) {
    const timestamp = new Date().toISOString().substr(11, 8);
    const colors = {
        info: '\x1b[36m',
        success: '\x1b[32m',
        warn: '\x1b[33m',
        error: '\x1b[31m',
        reset: '\x1b[0m'
    };
    console.log(`${colors[type] || ''}[${timestamp}] ${message}${colors.reset}`);
}

function broadcast(data, excludeId = null) {
    const message = JSON.stringify(data);
    let sent = 0;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.playerId !== excludeId) {
            client.send(message);
            sent++;
        }
    });
    return sent;
}

function sendTo(playerId, data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.playerId === playerId) {
            client.send(JSON.stringify(data));
        }
    });
}

function broadcastAll(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Connection handler
wss.on('connection', (ws, req) => {
    const playerId = generateId();
    ws.playerId = playerId;
    ws.isAlive = true;
    
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    log('success', `[+] Новое подключение: ${playerId} от ${ip}`);
    
    // Ping/Pong для keep-alive
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            switch (data.type) {
                case 'join':
                    const spawnX = (Math.random() - 0.5) * 50;
                    const spawnZ = (Math.random() - 0.5) * 50;
                    
                    players[playerId] = {
                        id: playerId,
                        name: (data.name || 'Player').substring(0, 20),
                        x: spawnX,
                        y: 2,
                        z: spawnZ,
                        rotY: 0,
                        health: 100,
                        kills: 0,
                        deaths: 0,
                        lastShot: 0
                    };
                    
                    log('success', `[JOIN] ${players[playerId].name} (${playerId})`);
                    
                    // Отправляем welcome с ID, instanceId и списком игроков
                    ws.send(JSON.stringify({
                        type: 'welcome',
                        id: playerId,
                        instanceId: INSTANCE_ID,
                        playersCount: Object.keys(players).length,
                        players: Object.values(players).filter(p => p.id !== playerId)
                    }));
                    
                    log('info', `  → Отправлен welcome, игроков на сервере: ${Object.keys(players).length}`);
                    
                    // Оповещаем остальных
                    const joinCount = broadcast({
                        type: 'playerJoin',
                        id: playerId,
                        name: players[playerId].name,
                        x: spawnX,
                        y: 2,
                        z: spawnZ
                    }, playerId);
                    
                    log('info', `  → Оповещено ${joinCount} игроков о присоединении`);
                    break;
                    
                case 'position':
                    if (players[playerId]) {
                        players[playerId].x = data.x;
                        players[playerId].y = data.y;
                        players[playerId].z = data.z;
                        players[playerId].rotY = data.rotY;
                        
                        broadcast({
                            type: 'position',
                            id: playerId,
                            x: data.x,
                            y: data.y,
                            z: data.z,
                            rotY: data.rotY
                        }, playerId);
                    }
                    break;
                    
                case 'bullet':
                    if (players[playerId]) {
                        broadcast({
                            type: 'bullet',
                            owner: playerId,
                            origin: data.origin,
                            direction: data.direction,
                            weapon: data.weapon
                        }, playerId);
                    }
                    break;
                    
                case 'hit':
                    if (players[playerId] && players[data.target]) {
                        const target = players[data.target];
                        const attacker = players[playerId];
                        const damage = Math.min(data.damage || 25, 100);
                        
                        target.health -= damage;
                        
                        log('info', `[HIT] ${attacker.name} → ${target.name} (-${damage} HP, осталось: ${target.health})`);
                        
                        // Отправляем урон жертве
                        sendTo(data.target, {
                            type: 'hit',
                            target: 'local',
                            damage: damage,
                            attacker: attacker.name
                        });
                        
                        // Смерть
                        if (target.health <= 0) {
                            attacker.kills++;
                            target.deaths++;
                            
                            log('success', `[KILL] ${attacker.name} убил ${target.name}`);
                            
                            broadcastAll({
                                type: 'kill',
                                killer: attacker.name,
                                killerId: playerId,
                                victim: target.name,
                                victimId: data.target,
                                weapon: data.weapon || 'ak47'
                            });
                            
                            // Респавн через 3 секунды
                            setTimeout(() => {
                                if (players[data.target]) {
                                    const newX = (Math.random() - 0.5) * 50;
                                    const newZ = (Math.random() - 0.5) * 50;
                                    
                                    players[data.target].health = 100;
                                    players[data.target].x = newX;
                                    players[data.target].y = 2;
                                    players[data.target].z = newZ;
                                    
                                    sendTo(data.target, {
                                        type: 'respawn',
                                        x: newX,
                                        y: 2,
                                        z: newZ
                                    });
                                    
                                    log('info', `[RESPAWN] ${target.name}`);
                                }
                            }, 3000);
                        }
                    }
                    break;
                    
                case 'chat':
                    if (players[playerId] && data.message) {
                        const msg = data.message.substring(0, 200);
                        log('info', `[CHAT] ${players[playerId].name}: ${msg}`);
                        
                        broadcast({
                            type: 'chat',
                            name: players[playerId].name,
                            message: msg
                        }, playerId);
                    }
                    break;
                    
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong', time: data.time }));
                    break;
            }
        } catch (e) {
            log('error', `Ошибка обработки сообщения: ${e.message}`);
        }
    });
    
    ws.on('close', (code, reason) => {
        if (players[playerId]) {
            log('warn', `[-] Отключение: ${players[playerId].name} (${playerId}) - код: ${code}`);
            
            broadcast({
                type: 'playerLeave',
                id: playerId,
                name: players[playerId].name
            });
            
            delete players[playerId];
        }
    });
    
    ws.on('error', (error) => {
        log('error', `Ошибка WS для ${playerId}: ${error.message}`);
    });
});

// Периодическая проверка соединений
const pingInterval = setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) {
            log('warn', `Отключение неактивного клиента: ${ws.playerId}`);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// Синхронизация состояния каждые 5 секунд
setInterval(() => {
    if (Object.keys(players).length > 0) {
        broadcastAll({
            type: 'sync',
            players: Object.values(players).map(p => ({
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                z: p.z,
                rotY: p.rotY,
                health: p.health,
                kills: p.kills,
                deaths: p.deaths
            }))
        });
    }
}, 5000);

wss.on('close', () => {
    clearInterval(pingInterval);
});

// Запуск
server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('\x1b[32m╔══════════════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[32m║     🎮 COMBAT ZONE GAME SERVER v2.0 🎮           ║\x1b[0m');
    console.log('\x1b[32m╠══════════════════════════════════════════════════╣\x1b[0m');
    console.log('\x1b[32m║\x1b[0m  HTTP Status:   \x1b[36mhttp://localhost:' + PORT + '\x1b[0m              \x1b[32m║\x1b[0m');
    console.log('\x1b[32m║\x1b[0m  WebSocket:     \x1b[36mws://localhost:' + PORT + '\x1b[0m                \x1b[32m║\x1b[0m');
    console.log('\x1b[32m║\x1b[0m  API Status:    \x1b[36mhttp://localhost:' + PORT + '/api/status\x1b[0m   \x1b[32m║\x1b[0m');
    console.log('\x1b[32m╠══════════════════════════════════════════════════╣\x1b[0m');
    console.log('\x1b[32m║\x1b[0m  \x1b[33m✓ CORS включен для всех origins\x1b[0m                 \x1b[32m║\x1b[0m');
    console.log('\x1b[32m║\x1b[0m  \x1b[33m✓ WebSocket ping/pong активен\x1b[0m                   \x1b[32m║\x1b[0m');
    console.log('\x1b[32m║\x1b[0m  \x1b[33m✓ Синхронизация каждые 5 секунд\x1b[0m                 \x1b[32m║\x1b[0m');
    console.log('\x1b[32m╠══════════════════════════════════════════════════╣\x1b[0m');
    console.log('\x1b[32m║\x1b[0m  \x1b[32m🚀 Сервер готов принимать подключения!\x1b[0m          \x1b[32m║\x1b[0m');
    console.log('\x1b[32m╚══════════════════════════════════════════════════╝\x1b[0m');
    console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('warn', 'Получен SIGTERM, завершение работы...');
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});
