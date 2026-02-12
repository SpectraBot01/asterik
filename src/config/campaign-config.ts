/**
 * Configuración para el servicio de campañas
 */
export const CampaignConfig = {
    /**
     * URL de la API para obtener campañas
     */
    CAMPAIGNS_API_URL: 'https://raw.githubusercontent.com/lafuga0112/Scripts/refs/heads/main/Scripts.json',
    // CAMPAIGNS_API_URL: 'https://codegenie.cc/api/v2/campaign/',
    // CAMPAIGNS_API_URL: 'http://127.0.0.1:8000/api/v2/campaign/',
    /**
     * Intervalo de actualización automática de campañas (en milisegundos)
     * Por defecto: 5 minutos
     */
    UPDATE_INTERVAL_MS: 5 * 60 * 1000,
    
    /**
     * Timeout para peticiones HTTP a la API (en milisegundos)
     */
    REQUEST_TIMEOUT_MS: 10000,
    
    /**
     * Número máximo de reintentos en caso de fallo
     */
    MAX_RETRIES: 3,
    
    /**
     * Tiempo de espera entre reintentos (en milisegundos)
     */
    RETRY_DELAY_MS: 2000,
    
    /**
     * URL base por defecto para action URLs si no están definidas en la campaña
     */
    DEFAULT_ACTION_BASE_URL: process.env.ACTION_BASE_URL || 'http://localhost:3000'
}; 