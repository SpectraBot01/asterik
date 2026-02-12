import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';

declare global {
    var activeConnections: Set<string>;
}

global.activeConnections = new Set<string>();

/**
 * Servicio WebSocket para manejo de conexiones en tiempo real
 * Gestiona conexiones individuales por callId, mensajes pendientes y estados
 */
export class WebSocketService {
    private static instance: WebSocketService;
    private wss: WebSocketServer | null = null;
    private connections: Map<string, WebSocket> = new Map();
    private pendingMessages: Map<string, object> = new Map();
    private lastState: Map<string, string> = new Map();

    private constructor() {}

    public static getInstance(): WebSocketService {
        if (!WebSocketService.instance) {
            WebSocketService.instance = new WebSocketService();
        }
        return WebSocketService.instance;
    }

    /**
     * Inicializa el servidor WebSocket
     */
    public initialize(server: Server): void {
        this.wss = new WebSocketServer({ server });
        this.wss.on('connection', this.handleConnection.bind(this));
    }

    /**
     * Maneja nuevas conexiones WebSocket
     */
    private handleConnection(ws: WebSocket, req: IncomingMessage): void {
        
        const callId = this.extractCallId(req);
        if (!callId) {
            ws.close();
            return;
        }


        if (!this.handleExistingConnection(callId, ws)) {
            return;
        }
        
        this.setupConnection(callId, ws);
        this.handlePendingMessages(callId);
        
        ws.on('message', (message) => this.handleMessage(callId, ws, message));
        ws.on('close', () => this.handleClose(callId));
        ws.on('error', (error) => this.handleError(callId, error));
    }

    /**
     * Extrae el callId de la URL de conexión
     * Formato esperado: ws://localhost:3000/?callId=call_xxx
     */
    private extractCallId(req: IncomingMessage): string | null {
        const url = req.url;
        if (!url) return null;
        
        const urlParams = new URLSearchParams(url.split('?')[1]);
        return urlParams.get('callId');
    }

    /**
     * Verifica y maneja conexiones existentes para un callId
     */
    private handleExistingConnection(callId: string, ws: WebSocket): boolean {
        const existingConnection = this.connections.get(callId);
        if (existingConnection?.readyState === WebSocket.OPEN) {
            ws.close();
            return false;
        }
        
        // Limpiar conexión anterior si existe
        this.connections.delete(callId);
        global.activeConnections.delete(callId);
        return true;
    }

    /**
     * Configura una nueva conexión para un callId
     */
    private setupConnection(callId: string, ws: WebSocket): void {
        this.connections.set(callId, ws);
        global.activeConnections.add(callId);
        
        // // Enviar mensaje de confirmación de conexión
        // this.sendToCallId(callId, {
        //     type: 'connection',
        //     status: 'connected',
        //     callId: callId,
        //     timestamp: new Date().toISOString()
        // });
    }

    /**
     * Procesa mensajes pendientes para un callId
     */
    private handlePendingMessages(callId: string): void {
        const pendingMessage = this.pendingMessages.get(callId);
        if (pendingMessage) {
            this.sendToCallId(callId, pendingMessage);
            this.pendingMessages.delete(callId);
        }
    }

    /**
     * Procesa mensajes entrantes de WebSocket
     */
    private handleMessage(callId: string, ws: WebSocket, message: WebSocket.RawData): void {
        try {
            const parsedMessage = JSON.parse(message.toString());
            
            this.lastState.set(callId, parsedMessage.status || 'unknown');
            
            // Echo del mensaje (opcional, para confirmación)
            this.sendToCallId(callId, {
                type: 'echo',
                originalMessage: parsedMessage,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error(`❌ Error parseando mensaje de ${callId}:`, error);
        }
    }

    /**
     * Maneja errores de WebSocket
     */
    private handleError(callId: string, error: Error): void {
        console.error(`❌ Error WebSocket para ${callId}:`, error);
    }

    /**
     * Maneja el cierre de una conexión
     */
    private handleClose(callId: string): void {
        this.connections.delete(callId);
        global.activeConnections.delete(callId);
        this.lastState.delete(callId);
    }

    /**
     * Envía un mensaje a un callId específico
     */
    public sendToCallId(callId: string, message: object): boolean {
        const ws = this.connections.get(callId);
        
        if (ws?.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(message));
                return true;
            } catch (error) {
                console.error(`❌ Error enviando mensaje a ${callId}:`, error);
                return false;
            }
        } else {
            this.pendingMessages.set(callId, message);
            return false;
        }
    }

    /**
     * Envía mensaje de estado de llamada
     */
    public sendCallStatus(callId: string, status: string, data?: any): void {
        const message = {
            type: 'call_status',
            callId: callId,
            status: status,
            data: data,
            timestamp: new Date().toISOString()
        };
        
        this.sendToCallId(callId, message);
        
        // Cerrar conexión si la llamada está completada
        if (status === 'completed' || status === 'failed' || status === 'hangup') {
            setTimeout(() => {
                this.closeConnection(callId);
            }, 5000); // Esperar 5 segundos antes de cerrar
        }
    }

    /**
     * Cierra una conexión específica
     */
    public closeConnection(callId: string): void {
        const ws = this.connections.get(callId);
        if (ws) {
            ws.close();
            this.handleClose(callId);
        }
    }

    /**
     * Obtiene estadísticas de conexiones
     */
    public getStats() {
        return {
            activeConnections: this.connections.size,
            pendingMessages: this.pendingMessages.size,
            connectedCallIds: Array.from(this.connections.keys()),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cierra todas las conexiones
     */
    public shutdown(): void {
        
        this.connections.forEach((ws, callId) => {
            ws.close();
        });
        
        this.connections.clear();
        this.pendingMessages.clear();
        this.lastState.clear();
        global.activeConnections.clear();
        
        if (this.wss) {
            this.wss.close();
        }
        
    }
} 