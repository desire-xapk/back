/**
 * 3D Shooter Multiplayer Server
 * Node.js WebSocket Server for Combat Zone
 * 
 * Для Cloudflare Workers используйте server-cf-worker.js
 * Для локального запуска: node server.js
 */

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

// Создаем HTTP сервер для health checks
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', players: Object.keys(players).length }));
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <html>
            <head><title>Combat Zone Server</title></head>
            <body style="background:#1a1a2e;color:white;font-family:Arial;padding:40px;">
                <h1>🎮 Combat Zone Game Server</h1>
                <p>WebSocket сервер запущен на порту ${PORT}</p>
                <p>Активных игроков: ${Object.keys(players).length}</p>
                <p>Подключитесь через ws://localhost:${PORT}</p>
            </body>
            </html>
        `);
    }
});

// WebSocket сервер
const wss = new WebSocket.Server({ server });

// Хранилище игроков
const players = {};

// Конфигурация оружия (для валидации урона)
const WEAPONS = {
    ak47: { damage: 25, fireRate: 100 },
    m4a1: { damage: 22, fireRate: 80 },
    awp: { damage: 100, fireRate: 1500 },
    deagle: { damage: 50, fireRate: 300 }
};

// Генерация уникального ID
function generateId() {
    return 'player_' + Math.random().toString(36).substr(2, 9);
}

// Отправка всем кроме отправителя
function broadcast(data, excludeId = null) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.playerId !== excludeId) {
            client.send(message);
        }
    });
}

// Отправка конкретному игроку
function sendToPlayer(playerId, data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.playerId === playerId) {
            client.send(JSON.stringify(data));
        }
    });
}

// Отправка всем
function broadcastAll(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

wss.on('connection', (ws) => {
    const playerId = generateId();
    ws.playerId = playerId;
    
    console.log(`[+] Новое подключение: ${playerId}`);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'join':
                    // Регистрация нового игрока
                    players[playerId] = {
                        id: playerId,
                        name: data.name || 'Player',
                        x: (Math.random() - 0.5) * 50,
                        y: 2,
                        z: (Math.random() - 0.5) * 50,
                        rotY: 0,
                        health: 100,
                        kills: 0,
                        deaths: 0,
                        lastShot: 0
                    };
                    
                    console.log(`[JOIN] ${players[playerId].name} (${playerId})`);
                    
                    // Отправляем игроку его ID
                    ws.send(JSON.stringify({
                        type: 'welcome',
                        id: playerId,
                        players: Object.values(players).filter(p => p.id !== playerId)
                    }));
                    
                    // Оповещаем других
                    broadcast({
                        type: 'playerJoin',
                        id: playerId,
                        name: players[playerId].name,
                        x: players[playerId].x,
                        y: players[playerId].y,
                        z: players[playerId].z
                    }, playerId);
                    break;
                    
                case 'position':
                    // Обновление позиции игрока
                    if (players[playerId]) {
                        players[playerId].x = data.x;
                        players[playerId].y = data.y;
                        players[playerId].z = data.z;
                        players[playerId].rotY = data.rotY;
                        
                        // Транслируем позицию другим
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
                    // Игрок выстрелил
                    if (players[playerId]) {
                        const now = Date.now();
                        const weapon = WEAPONS[data.weapon] || WEAPONS.ak47;
                        
                        // Anti-cheat: проверка скорострельности
                        if (now - players[playerId].lastShot < weapon.fireRate * 0.8) {
                            console.log(`[WARN] Слишком быстрая стрельба от ${playerId}`);
                            return;
                        }
                        players[playerId].lastShot = now;
                        
                        // Транслируем пулю другим
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
                    // Игрок попал в кого-то
                    if (players[playerId] && players[data.target]) {
                        const target = players[data.target];
                        const damage = Math.min(data.damage, 100); // Лимит урона
                        
                        target.health -= damage;
                        
                        // Отправляем урон жертве
                        sendToPlayer(data.target, {
                            type: 'hit',
                            target: 'local',
                            damage: damage,
                            attacker: playerId
                        });
                        
                        console.log(`[HIT] ${players[playerId].name} -> ${target.name} (-${damage} HP, осталось: ${target.health})`);
                        
                        // Проверяем смерть
                        if (target.health <= 0) {
                            players[playerId].kills++;
                            target.deaths++;
                            
                            // Оповещаем всех об убийстве
                            broadcastAll({
                                type: 'kill',
                                killer: players[playerId].name,
                                killerId: playerId,
                                victim: target.name,
                                victimId: data.target,
                                weapon: data.weapon || 'ak47'
                            });
                            
                            console.log(`[KILL] ${players[playerId].name} убил ${target.name}`);
                            
                            // Респавн жертвы
                            setTimeout(() => {
                                if (players[data.target]) {
                                    players[data.target].health = 100;
                                    players[data.target].x = (Math.random() - 0.5) * 50;
                                    players[data.target].y = 2;
                                    players[data.target].z = (Math.random() - 0.5) * 50;
                                    
                                    sendToPlayer(data.target, {
                                        type: 'respawn',
                                        x: players[data.target].x,
                                        y: players[data.target].y,
                                        z: players[data.target].z
                                    });
                                }
                            }, 3000);
                        }
                    }
                    break;
                    
                case 'chat':
                    // Чат сообщение
                    if (players[playerId] && data.message) {
                        const msg = data.message.substring(0, 200); // Лимит длины
                        console.log(`[CHAT] ${players[playerId].name}: ${msg}`);
                        
                        broadcast({
                            type: 'chat',
                            name: players[playerId].name,
                            message: msg
                        }, playerId);
                    }
                    break;
                    
                case 'ping':
                    // Пинг для измерения задержки
                    ws.send(JSON.stringify({ type: 'pong', time: data.time }));
                    break;
            }
        } catch (e) {
            console.error('Ошибка обработки сообщения:', e);
        }
    });
    
    ws.on('close', () => {
        if (players[playerId]) {
            console.log(`[-] Отключение: ${players[playerId].name} (${playerId})`);
            
            broadcast({
                type: 'playerLeave',
                id: playerId,
                name: players[playerId].name
            });
            
            delete players[playerId];
        }
    });
    
    ws.on('error', (error) => {
        console.error(`Ошибка WebSocket для ${playerId}:`, error);
    });
});

// Периодическая синхронизация состояния
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

// Запуск сервера
server.listen(PORT, () => {
    console.log('╔════════════════════════════════════════╗');
    console.log('║     🎮 COMBAT ZONE GAME SERVER 🎮      ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║  HTTP:      http://localhost:${PORT}       ║`);
    console.log(`║  WebSocket: ws://localhost:${PORT}         ║`);
    console.log('╠════════════════════════════════════════╣');
    console.log('║  Готов принимать подключения!         ║');
    console.log('╚════════════════════════════════════════╝');
});
