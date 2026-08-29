import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Message, Thread, Channel, DeliveryStatus } from '../types';

interface MessageState {
  threads: Record<string, Thread>;
  channels: Record<string, Channel>;
  // messages keyed by threadId or channelId → message array
  messages: Record<string, Message[]>;

  upsertThread: (thread: Thread) => void;
  upsertChannel: (channel: Channel) => void;
  addMessage: (scopeId: string, message: Message) => void;
  updateDeliveryStatus: (messageId: string, scopeId: string, status: DeliveryStatus) => void;
  markThreadRead: (threadId: string) => void;
  markChannelRead: (channelId: string) => void;
}

export const useMessageStore = create<MessageState>()(
  immer(set => ({
    threads: {},
    channels: {},
    messages: {},

    upsertThread: thread =>
      set(state => {
        state.threads[thread.id] = thread;
      }),

    upsertChannel: channel =>
      set(state => {
        state.channels[channel.id] = channel;
      }),

    addMessage: (scopeId, message) =>
      set(state => {
        if (!state.messages[scopeId]) {
          state.messages[scopeId] = [];
        }
        const existing = state.messages[scopeId]!.findIndex(m => m.id === message.id);
        if (existing === -1) {
          state.messages[scopeId]!.push(message);
          state.messages[scopeId]!.sort((a, b) => a.createdAt - b.createdAt);
        }
      }),

    updateDeliveryStatus: (messageId, scopeId, status) =>
      set(state => {
        const msgs = state.messages[scopeId];
        if (!msgs) return;
        const msg = msgs.find(m => m.id === messageId);
        if (msg) {
          msg.deliveryStatus = status;
        }
      }),

    markThreadRead: threadId =>
      set(state => {
        if (state.threads[threadId]) {
          state.threads[threadId]!.unreadCount = 0;
        }
      }),

    markChannelRead: channelId =>
      set(state => {
        if (state.channels[channelId]) {
          state.channels[channelId]!.unreadCount = 0;
        }
      }),
  })),
);
