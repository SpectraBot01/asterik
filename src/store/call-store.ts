interface CallData {
    uuid: string;
    state: string;
    campaign: string;
    created_at: Date;
    selectedOption?: string; // Para campañas con menú (ej: "1" o "2")
    gatherStage?: 'first' | 'second'; // Para campañas con dos Gather (ej: "boostMobile")
}

/**
 * Store en memoria para gestionar datos de llamadas activas
 * Similar al repositorio original del WebSocket
 */
class CallStore {
    private static instance: CallStore;
    private calls: Map<string, CallData>;
    private readonly CLEANUP_INTERVAL = 60 * 1000; // 1 minuto
    private readonly EXPIRATION_TIME = 15; // 15 minutos

    private constructor() {
        this.calls = new Map();
        setInterval(() => this.cleanupExpiredCalls(), this.CLEANUP_INTERVAL);
    }

    public static getInstance(): CallStore {
        if (!CallStore.instance) {
            CallStore.instance = new CallStore();
        }
        return CallStore.instance;
    }

    /**
     * Guarda datos de una llamada en memoria
     */
    public saveCall(uuid: string, state: string, campaign: string): void {
        const callData: CallData = {
            uuid,
            state,
            campaign,
            created_at: new Date()
        };

        this.calls.set(uuid, callData);
    }

    /**
     * Obtiene datos de una llamada por UUID
     */
    public getCall(uuid: string): CallData | null {
        const callData = this.calls.get(uuid);
        return callData || null;
    }

    /**
     * Actualiza el estado de una llamada
     */
    public updateCall(uuid: string, updates: Partial<CallData>): void {
        const existingCall = this.calls.get(uuid);
        if (existingCall) {
            this.calls.set(uuid, { ...existingCall, ...updates });
        }
    }

    /**
     * Elimina una llamada de memoria
     */
    public removeCall(uuid: string): void {
        this.calls.delete(uuid);
    }

    /**
     * Limpia llamadas expiradas automáticamente
     */
    private cleanupExpiredCalls(): void {
        const now = new Date();
        const expiredCalls: string[] = [];

        this.calls.forEach((callData, uuid) => {
            const timeDiff = now.getTime() - callData.created_at.getTime();
            const minutesDiff = timeDiff / (1000 * 60);

            if (minutesDiff > this.EXPIRATION_TIME) {
                expiredCalls.push(uuid);
            }
        });

        expiredCalls.forEach(uuid => {
            this.calls.delete(uuid);
        });

        if (expiredCalls.length > 0) {
        }
    }

    /**
     * Obtiene todas las llamadas activas (para debugging)
     */
    public getAllCalls(): Map<string, CallData> {
        return new Map(this.calls);
    }
}

export { CallStore, CallData }; 