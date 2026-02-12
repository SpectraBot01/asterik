export interface ServerConfig {
    name?: string;  // Opcional, se genera automáticamente
    host: string;
    username: string;
    password: string;
}

export interface PlaybackOptions {
    media: string;
    skipMS?: number;
    playbackId?: string;
    bargein?: boolean;
}

export interface ChannelResponse {
    id: string;
    name: string;
    state: string;
    caller: {
        number: string;
        name: string;
    };
}

export interface ActionAttributes {
    timeout?: number;
    numDigits?: number;
    finishOnKey?: string;  // 🆕 Carácter para terminar gather dinámicamente
    action?: string;
    Digits?: string;
}

export interface Action {
    name: string;
    data?: string;
    attributes?: ActionAttributes;
}

export interface Call {
    callId?: string;
    to_number: string;
    from_number: string;
    trunk: string;
    action_url?: string;
    status_callback?: string;
    status?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

export type XMLResult = {
    Response: {
        [key: string]: any;
    };
};

export type CreateCallDto = Omit<Call, 'callId' | 'createdAt' | 'updatedAt'>; 