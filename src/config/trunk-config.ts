/**
 * Configuración para el sistema de trunks
 */
export class TrunkConfig {
    /**
     * URL de la API para obtener todos los trunks
     */
    public static readonly TRUNK_API_URL = 'https://spectrabot.net/api/get-trunks/';
    
    /**
     * Intervalo de actualización automática en milisegundos (30 segundos)
     */
    public static readonly UPDATE_INTERVAL_MS = 30 * 1000;
    
    /**
     * TTL para asignaciones de trunks en milisegundos (2 minutos)
     */
    public static readonly ASSIGNMENT_TTL_MS = 2 * 60 * 1000;
    
    /**
     * Límite máximo de uso por trunk (solo para custom/telnyx)
     * Los demás trunks (Twilio, etc.) tienen uso ilimitado
     */
    public static readonly MAX_TRUNK_USAGE = 4;
} 