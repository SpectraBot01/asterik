interface QueueElement {
    id: string;
    callFunction: () => Promise<any>;
}

/**
 * Administrador de cola para llamadas salientes
 * Controla rate limiting por trunk (1 llamada cada 1.1 segundos)
 * Migrado del sistema WebSocket antiguo
 */
export class QueueManager {
    private static instance: QueueManager;
    private queues: Map<string, QueueElement[]> = new Map();
    private processing: Set<string> = new Set();
    private lastCallTime: Map<string, number> = new Map(); // Timestamp de última llamada por trunk
    private readonly PROCESS_DELAY = 1100; // 1.1 segundos entre llamadas
    private readonly QUEUE_LIMIT = 50;

    private constructor() {}

    public static getInstance(): QueueManager {
        if (!QueueManager.instance) {
            QueueManager.instance = new QueueManager();
        }
        return QueueManager.instance;
    }

    /**
     * Encola una nueva llamada para ser procesada
     * @param trunkId - Identificador del trunk
     * @param callFunction - Función que origina la llamada
     * @returns Promise con el resultado de la llamada
     */
    public async enqueue(trunkId: string, callFunction: () => Promise<any>): Promise<any> {
        
        if (!this.queues.has(trunkId)) {
            this.queues.set(trunkId, []);
        }

        const queue = this.queues.get(trunkId)!;
        if (queue.length >= this.QUEUE_LIMIT) {
            throw new Error(`Cola llena para el trunk ${trunkId} (máximo ${this.QUEUE_LIMIT})`);
        }

        return new Promise((resolve, reject) => {
            const queueElement: QueueElement = {
                id: this.generateUniqueId(),
                callFunction: async () => {
                    try {
                        const result = await callFunction();
                        resolve(result);
                        return result;
                    } catch (error) {
                        reject(error);
                        return error;
                    }
                }
            };

            queue.push(queueElement);

            // Iniciar procesamiento si no está ya en proceso
            if (!this.processing.has(trunkId)) {
                this.processQueue(trunkId);
            } else {
            }
        });
    }

    /**
     * Procesa la cola de un trunk específico
     * @param trunkId - Identificador del trunk
     */
    private async processQueue(trunkId: string): Promise<void> {
        
        if (this.processing.has(trunkId)) {
            return;
        }

        this.processing.add(trunkId);
        const queue = this.queues.get(trunkId);

        try {
            while (queue && queue.length > 0) {
                // Verificar si ha pasado suficiente tiempo desde la última llamada
                const lastTime = this.lastCallTime.get(trunkId) || 0;
                const now = Date.now();
                const timeSinceLastCall = now - lastTime;
                
                if (timeSinceLastCall < this.PROCESS_DELAY) {
                    const waitTime = this.PROCESS_DELAY - timeSinceLastCall;
                    await this.sleep(waitTime);
                }
                
                const element = queue[0];
                
                try {
                    await element.callFunction();
                    // Actualizar tiempo de última llamada procesada
                    this.lastCallTime.set(trunkId, Date.now());
                } catch (error) {
                    console.error(`❌ Error en llamada ${element.id} para trunk ${trunkId}:`, error);
                    // Aunque falle, actualizar el tiempo para mantener rate limiting
                    this.lastCallTime.set(trunkId, Date.now());
                } finally {
                    queue.shift();
                }
            }
        } finally {
            this.processing.delete(trunkId);
        }
    }

    /**
     * Genera un ID único para cada elemento de la cola
     */
    private generateUniqueId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Función sleep para delays
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Limpia una cola específica o todas las colas
     * @param trunkId - Identificador del trunk (opcional)
     */
    public clear(trunkId?: string): void {
        if (trunkId) {
            this.queues.delete(trunkId);
            this.processing.delete(trunkId);
            this.lastCallTime.delete(trunkId);
        } else {
            this.queues.clear();
            this.processing.clear();
            this.lastCallTime.clear();
        }
    }

    /**
     * Obtiene estadísticas de las colas
     */
    public getStats() {
        const stats: { [trunkId: string]: { pending: number; processing: boolean; lastCallTime?: string } } = {};
        
        this.queues.forEach((queue, trunkId) => {
            const lastTime = this.lastCallTime.get(trunkId);
            stats[trunkId] = {
                pending: queue.length,
                processing: this.processing.has(trunkId),
                lastCallTime: lastTime ? new Date(lastTime).toISOString() : undefined
            };
        });

        return {
            totalQueues: this.queues.size,
            totalProcessing: this.processing.size,
            queueStats: stats,
            timestamp: new Date().toISOString()
        };
    }
} 