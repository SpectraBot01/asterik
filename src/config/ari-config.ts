import { ServerConfig } from '../modules/ari/types';

/**
 * Configuración para servidores ARI/Asterisk
 */
export class ARIConfig {
    /**
     * Credenciales ARI fijas (hardcodeadas)
     */
    public static readonly ARI_USERNAME = 'z60wgclSgTCIMeJElBMNYAh8Ez271UxwMZcSGHH7oSKYHAX30O';
    public static readonly ARI_PASSWORD = '5q233vkP368RMr2oMD1f8cmhnl9ysFstmS0ARn9IGpI4dtGX1f';
    
    /**
     * Timeout para conexiones ARI en milisegundos
     */
    public static readonly CONNECTION_TIMEOUT_MS = 5000;
    
    /**
     * Número máximo de reintentos de conexión
     */
    public static readonly MAX_RETRIES = 3;
} 