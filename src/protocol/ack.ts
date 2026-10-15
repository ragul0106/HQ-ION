export interface AckBody {
  message: {
    status: 'ACK' | 'NACK';
    messageId: string;
    error?: { code: string; message: string };
  };
}

/** The synchronous reply to every request: "I accepted it". The business answer comes later as a callback. */
export function ack(messageId: string): AckBody {
  return { message: { status: 'ACK', messageId } };
}

export function nack(messageId: string, code: string, message: string): AckBody {
  return { message: { status: 'NACK', messageId, error: { code, message } } };
}
