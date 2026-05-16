type NotifyType = 'success' | 'error' | 'info';

export interface NotifyMsg {
  id: number;
  type: NotifyType;
  text: string;
  text2?: string;
}

type Listener = (msg: NotifyMsg) => void;
const listeners = new Set<Listener>();

const emit = (type: NotifyType, text: string, text2?: string) => {
  const msg: NotifyMsg = { id: Date.now(), type, text, text2 };
  listeners.forEach(l => l(msg));
};

export const notify = {
  success: (text: string, text2?: string) => emit('success', text, text2),
  error: (text: string, text2?: string) => emit('error', text, text2),
  info: (text: string, text2?: string) => emit('info', text, text2),
  _subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
