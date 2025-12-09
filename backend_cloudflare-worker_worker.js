/**
 * Combat Zone - Cloudflare Workers WebSocket Server
 * Использует Durable Objects для хранения состояния игры
 * 
 * Деплой:
 * 1. npx wrangler login
 * 2. npx wrangler deploy
 */

// Durable Object для управления игровой сессией
export class GameRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.players = new Map();
        this.sessions = new Map();
    }

    async fetch(request) {
        const url = new URL(request.url);
        
        // WebSocket upgrade
        if (request.headers.get("Upgrade") === "websocket") {
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);
            
            await this.handleSession(server);
            
            return new Response(null, {
                status: 101,
                webSocket: client,
            });
        }
        
        // HTTP endpoints
        if (url.pathname === "/status") {
            return new Response(JSON.stringify({
                players: this.players.size,
                playerList: Array.from(this.players.values()).map(p => ({
                    name: p.name,
                    kills: p.kills,
                    deaths: p.deaths
                }))
            }), {
                headers: { "Content-Type": "application/json" }
            });
        }
        
        return new Response("Combat Zone Game Server", { status: 200 });
    }

    async handleSession(webSocket) {
        webSocket.accept();
        
        const playerId = 'player_' + crypto.randomUUID().substring(0, 8);
        
        this.sessions.set(playerId, webSocket);
        
        webSocket.addEventListener("message", async (event) => {
            try {
                const data = JSON.parse(event.data);
                await this.handleMessage(playerId, data, webSocket);
            } catch (e) {
                console.error("Message error:", e);
            }
        });
        
        webSocket.addEventListener("close", () => {
            this.handleDisconnect(playerId);
        });
        
        webSocket.addEventListener("error", (e) => {
            console.error("WebSocket error:", e);
            this.handleDisconnect(playerId);
        });
    }

    async handleMessage(playerId, data, ws) {
        switch (data.type) {
            case 'join':
                this.players.set(playerId, {
                    id: playerId,
                    name: data.name || 'Player',
                    x: (Math.random() - 0.5) * 50,
                    y: 2,
                    z: (Math.random() - 0.5) * 50,
                    rotY: 0,
                    health: 100,
                    kills: 0,
                    deaths: 0
                });
                
                // Отправляем приветствие
                ws.send(JSON.stringify({
                    type: 'welcome',
                    id: playerId,
                    players: Array.from(this.players.values()).filter(p => p.id !== playerId)
                }));
                
                // Оповещаем других
                this.broadcast({
                    type: 'playerJoin',
                    id: playerId,
                    name: this.players.get(playerId).name
                }, playerId);
                break;
                
            case 'position':
                const player = this.players.get(playerId);
                if (player) {
                    player.x = data.x;
                    player.y = data.y;
                    player.z = data.z;
                    player.rotY = data.rotY;
                    
                    this.broadcast({
                        type: 'position',
                        id: playerId,
                        ...data
                    }, playerId);
                }
                break;
                
            case 'bullet':
                this.broadcast({
                    type: 'bullet',
                    owner: playerId,
                    ...data
                }, playerId);
                break;
                
            case 'hit':
                const target = this.players.get(data.target);
                const attacker = this.players.get(playerId);
                
                if (target && attacker) {
                    target.health -= Math.min(data.damage, 100);
                    
                    const targetWs = this.sessions.get(data.target);
                    if (targetWs) {
                        targetWs.send(JSON.stringify({
                            type: 'hit',
                            target: 'local',
                            damage: data.damage
                        }));
                    }
                    
                    if (target.health <= 0) {
                        attacker.kills++;
                        target.deaths++;
                        
                        this.broadcast({
                            type: 'kill',
                            killer: attacker.name,
                            victim: target.name,
                            weapon: data.weapon || 'ak47'
                        });
                        
                        // Respawn
                        setTimeout(() => {
                            if (this.players.has(data.target)) {
                                target.health = 100;
                                target.x = (Math.random() - 0.5) * 50;
                                target.y = 2;
                                target.z = (Math.random() - 0.5) * 50;
                            }
                        }, 3000);
                    }
                }
                break;
                
            case 'chat':
                if (this.players.has(playerId)) {
                    this.broadcast({
                        type: 'chat',
                        name: this.players.get(playerId).name,
                        message: data.message.substring(0, 200)
                    }, playerId);
                }
                break;
                
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', time: data.time }));
                break;
        }
    }

    handleDisconnect(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            this.broadcast({
                type: 'playerLeave',
                id: playerId,
                name: player.name
            });
            this.players.delete(playerId);
        }
        this.sessions.delete(playerId);
    }

    broadcast(data, excludeId = null) {
        const message = JSON.stringify(data);
        this.sessions.forEach((ws, id) => {
            if (id !== excludeId && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(message);
                } catch (e) {
                    console.error("Broadcast error:", e);
                }
            }
        });
    }
}

// Main Worker
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        
        // CORS headers
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };
        
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }
        
        // Route to game room
        const roomId = url.searchParams.get("room") || "default";
        const id = env.GAME_ROOM.idFromName(roomId);
        const room = env.GAME_ROOM.get(id);
        
        // Forward request to Durable Object
        const response = await room.fetch(request);
        
        // Add CORS headers to response
        const newResponse = new Response(response.body, response);
        Object.entries(corsHeaders).forEach(([key, value]) => {
            newResponse.headers.set(key, value);
        });
        
        return newResponse;
    }
};
