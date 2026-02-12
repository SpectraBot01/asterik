import crypto from 'crypto';
import { ARIRestClient } from './rest-client';
import { Call, Action, ActionAttributes, XMLResult } from './types';
import { parseString } from 'xml2js';
import { promisify } from 'util';
import axios from 'axios';

const parseXML = promisify(parseString);

export class ChannelManager {
    public id: string;
    public api: ARIRestClient;
    public call: Call;
    protected answerDate: Date;

    protected remainingActions: Action[] = [];
    protected gatherInstance = {
        digits: "",
        running: false,
        numDigits: 1,
        finishOnKey: undefined as string | undefined,  // 🆕 Carácter para terminar gather dinámicamente
        action: undefined as string | undefined,
        timeout: undefined as NodeJS.Timeout | undefined,
        timeoutSeconds: 5
    };

    protected playbackId: string = '';
    protected isPlaying: boolean = false;
    protected currentTimeout: number = 0;
    protected timeoutHandle?: NodeJS.Timeout;
    protected pendingAction?: { url: string, params?: any };
    protected currentActionStatus: string = '';
    private isDestroyed: boolean = false;

    constructor(call: Call, api: ARIRestClient, channelId: string) {
        this.call = call;
        this.api = api;
        this.id = channelId;
        this.answerDate = new Date();
    }

    async start(): Promise<void> {
        try {
            this.answerDate = new Date();
            if (this.call.action_url) {
                await this.getActions(this.call.action_url);
                return this.runAction();
            }
        } catch (error) {
            await this.handleError(error);
        }
    }

    public async setAction(url: string, params = {}): Promise<void> {
        try {
            if (this.timeoutHandle) {
                clearTimeout(this.timeoutHandle);
                this.timeoutHandle = undefined;
            }

            await this.getActions(url, params);
            return this.runAction();
        } catch (error) {
            await this.handleError(error);
        }
    }

    protected async getActions(actionUrl: string, params = {}): Promise<Action[]> {
        try {
            // Para la primera llamada (answer), agregar UUID. Para las siguientes, ya viene en la URL
            const finalUrl = actionUrl.includes('uuid=') ? actionUrl : this.addUuidToUrl(actionUrl);
            
            // Detectar qué tipo de acción estamos procesando
            if (finalUrl.includes('/completed')) {
                this.currentActionStatus = 'completed';
            } else if (finalUrl.includes('/invalid')) {
                this.currentActionStatus = 'invalid';
            } else if (finalUrl.includes('/gather')) {
                this.currentActionStatus = 'gather';
            } else if (finalUrl.includes('/answer')) {
                this.currentActionStatus = 'answer';
            }
            
            const xmlResponse = await this.api.fetchActionXML(finalUrl, params);
            const result: any = await parseXML(xmlResponse);

            if (result?.Response) {
                this.remainingActions = this.parseXMLToActions(result.Response);
                return this.remainingActions;
            }
            return [];
        } catch (error) {
            console.error('Error getting actions:', error);
            this.destroy();
            return [];
        }
    }
    
    /**
     * Agrega el UUID a la URL de acción
     */
    private addUuidToUrl(actionUrl: string): string {
        const separator = actionUrl.includes('?') ? '&' : '?';
        return `${actionUrl}${separator}uuid=${this.id}`;
    }

    protected parseXMLToActions(response: any): Action[] {
        const actions: Action[] = [];

        Object.keys(response).forEach(key => {
            const elements = response[key];
            
            if (Array.isArray(elements)) {
                elements.forEach(element => {
                    const action: Action = {
                        name: key.toLowerCase() as any,
                        data: element._ || element,
                        attributes: element.$ || {}
                    };
                    actions.push(action);
                });
            } else {
                // Manejar elementos no-array también
                const action: Action = {
                    name: key.toLowerCase() as any,
                    data: elements._ || elements,
                    attributes: elements.$ || {}
                };
                actions.push(action);
            }
        });

        return actions;
    }

    protected async runAction(): Promise<void> {
        try {
            if (this.remainingActions.length > 0) {
                const action = this.remainingActions.shift();
                if (action) {
                    // Limpiar timeout anterior
                    if (this.timeoutHandle) {
                        clearTimeout(this.timeoutHandle);
                        this.timeoutHandle = undefined;
                    }
                    
                    this.currentTimeout = Number(action.attributes?.timeout) || 0;

                    switch (action.name) {
                        case 'play':
                            if (!action.data) {
                                console.error('Error: URL de audio vacía');
                                await this.runAction();
                            } else {
                                await this.play(action.data, action.attributes);
                                // Continuar inmediatamente con la siguiente acción (gather)
                                await this.runAction();
                            }
                            break;
                        case 'gather':
                            await this.gather(action.attributes || {});
                            break;
                        case 'redirect':
                            if (action.data) {
                                await this.redirect(action.data, action.attributes);
                            }
                            break;
                        case 'hangup':
                            await this.hangup();
                            break;
                        default:
                            await this.runAction();
                    }
                }
            }
        } catch (error) {
            await this.handleError(error);
        }
    }

    protected async play(audioUrl: string, attrib?: ActionAttributes): Promise<void> {
        try {
            // Usar playbackId único por reproducción para evitar colisiones
            const playbackId = `${this.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            this.playbackId = playbackId;
            this.isPlaying = true;

            await this.api.play(this.id, {
                media: audioUrl,
                playbackId: playbackId
            });

            // Si hay timeout, configurarlo
            if (this.currentTimeout > 0) {
                this.timeoutHandle = setTimeout(async () => {
                    await this.handleTimeout();
                }, this.currentTimeout * 1000);
            }

            // NO llamar a runAction() automáticamente como en el sistema antiguo
            // El gather se ejecutará después del play automáticamente

        } catch (error) {
            console.error('Error en play:', error);
            await this.runAction();
        }
    }

    protected async gather(attrib: ActionAttributes): Promise<void> {
        try {            
            this.gatherInstance.running = true;
            this.gatherInstance.numDigits = attrib.numDigits || 1;
            this.gatherInstance.finishOnKey = attrib.finishOnKey;  // 🆕 Guardar finishOnKey si existe
            this.gatherInstance.action = attrib.action;
            this.gatherInstance.timeoutSeconds = attrib.timeout || 5;
            this.gatherInstance.digits = "";

            // Configurar timeout para gather
            // Si hay audio reproduciéndose, diferir el inicio del timeout hasta que termine el playback
            if (this.isPlaying) {
                if (this.gatherInstance.timeout) {
                    clearTimeout(this.gatherInstance.timeout);
                    this.gatherInstance.timeout = undefined;
                }
            } else {
                this.gatherInstance.timeout = setTimeout(async () => {
                    if (this.gatherInstance.running) {
                        this.gatherInstance.running = false;
                        await this.destroy();
                    }
                }, this.gatherInstance.timeoutSeconds * 1000);
            }

        } catch (error) {
            console.error('Error en gather:', error);
            await this.runAction();
        }
    }

    protected async redirect(url: string, attrib?: ActionAttributes): Promise<void> {
        try {
            await this.setAction(url, attrib);
        } catch (error) {
            console.error('Error en redirect:', error);
            await this.runAction();
        }
    }

    protected async hangup(): Promise<void> {
        try {
            await this.api.hangup(this.id);
            await this.destroy();
        } catch (error) {
            console.error('Error en hangup:', error);
            await this.destroy();
        }
    }

    public async onDTMFReceived(digit: string): Promise<void> {

        // BARGE-IN INMEDIATO: Parar audio si está reproduciéndose (como el sistema original)
        if (this.isPlaying && this.playbackId) {
            try {
                await this.api.stopPlayback(this.playbackId);
                this.isPlaying = false;
                this.playbackId = '';
            } catch (error) {
                // Continuar aunque falle el stop
                this.isPlaying = false;
                this.playbackId = '';
            }
        }
        
        // Limpiar timeout de playback si existe
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = undefined;
        }
        
        if (this.gatherInstance.running) {
            // 🆕 NUEVA LÓGICA: Verificar si el dígito es el terminador (finishOnKey)
            // Solo se ejecuta si finishOnKey está definido
            if (this.gatherInstance.finishOnKey && digit === this.gatherInstance.finishOnKey) {
                this.gatherInstance.running = false;
                
                // Limpiar timeout de gather
                if (this.gatherInstance.timeout) {
                    clearTimeout(this.gatherInstance.timeout);
                    this.gatherInstance.timeout = undefined;
                }

                if (this.gatherInstance.action) {
                    // NO incluir el terminador en los dígitos enviados
                    await this.getActions(this.gatherInstance.action, {
                        Digits: this.gatherInstance.digits
                    });
                    await this.runAction();
                }
                return; // Salir sin agregar el terminador a los dígitos
            }
            
            // ✅ LÓGICA ORIGINAL: Agregar dígito normalmente
            this.gatherInstance.digits += digit;
            
            // ✅ LÓGICA ORIGINAL: Verificar si alcanzó el máximo de dígitos (modo fijo)
            // Solo aplica cuando NO hay finishOnKey configurado
            if (!this.gatherInstance.finishOnKey && this.gatherInstance.digits.length >= this.gatherInstance.numDigits) {
                this.gatherInstance.running = false;
                
                // Limpiar timeout de gather
                if (this.gatherInstance.timeout) {
                    clearTimeout(this.gatherInstance.timeout);
                    this.gatherInstance.timeout = undefined;
                }

                if (this.gatherInstance.action) {
                    // Igual que el sistema antiguo: getActions + runAction
                    await this.getActions(this.gatherInstance.action, {
                        Digits: this.gatherInstance.digits
                    });
                    await this.runAction();
                }
            }
        } else {
        }
    }

    public async onPlaybackFinished(playbackId?: string): Promise<void> {
        if (playbackId && this.playbackId && playbackId !== this.playbackId) {
            return;
        }

        
        this.isPlaying = false;
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = undefined;
        }
        
        // Como el sistema antiguo: verificar si hay acción pendiente
        if (this.pendingAction) {
            const { url, params } = this.pendingAction;
            this.pendingAction = undefined;
            await this.getActions(url, params);
            await this.runAction();
            return;
        }

        // Si gather está activo, reiniciar su timeout para que comience DESPUÉS del audio
        if (this.gatherInstance.running) {
            if (this.gatherInstance.timeout) {
                clearTimeout(this.gatherInstance.timeout);
                this.gatherInstance.timeout = undefined;
            }
            this.gatherInstance.timeout = setTimeout(async () => {
                if (this.gatherInstance.running) {
                    this.gatherInstance.running = false;
                    await this.destroy();
                }
            }, this.gatherInstance.timeoutSeconds * 1000);
            // No programar destrucción aún; esperar al resultado del gather o su timeout
            return;
        }

        // Como el sistema antiguo: si no hay más acciones, iniciar timeout
        if (this.remainingActions.length === 0) {
            // IGUAL que el sistema antiguo: SIEMPRE usar setTimeout, incluso para timeout=0
            this.timeoutHandle = setTimeout(async () => {
                await this.destroy();
            }, this.currentTimeout * 1000);
        } else {
            // Si hay más acciones, continuar
            await this.runAction();
        }
    }

    protected async handleTimeout(): Promise<void> {
        if (this.pendingAction) {
            await this.setAction(this.pendingAction.url, this.pendingAction.params);
            this.pendingAction = undefined;
        } else {
            await this.runAction();
        }
    }

    protected async handleError(error: any): Promise<void> {
        console.error('Error en ChannelManager:', error);
        await this.destroy();
    }

    public async destroy(): Promise<void> {
        if (this.isDestroyed) {
            return;
        }
        this.isDestroyed = true;
        
        // 1. Limpiar timeouts
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = undefined;
        }
        if (this.gatherInstance.timeout) {
            clearTimeout(this.gatherInstance.timeout);
            this.gatherInstance.timeout = undefined;
        }
        this.isPlaying = false;
        this.playbackId = '';
        
        // 2. Colgar físicamente la llamada en Asterisk (como sistema antiguo)
        try {
            await this.api.hangup(this.id);
        } catch (error: any) {
            // Ignorar error 404 (canal ya no existe)
            if (error?.response?.status === 404) {
            } else {
                console.error(`❌ Error colgando canal ${this.id}:`, error);
            }
        }
        
    }

    private generateUUID(): string {
        return crypto.randomUUID();
    }
} 