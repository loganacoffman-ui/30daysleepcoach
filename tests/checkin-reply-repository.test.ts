import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '../mobile/supabase';
import { interpretTypedCheckinReply } from '../mobile/today/checkinReplyRepository';
import { startCheckin } from '../mobile/today/checkinConversation';

vi.mock('../mobile/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
const invoke = vi.mocked(supabase.functions.invoke);
const interpretation = { addressed: true, answer: 'skipped', finish: false, clarification: null };

beforeEach(() => { invoke.mockReset(); });

describe('mobile check-in interpretation API', () => {
  it('sends the natural reply and current question to the authenticated function', async () => {
    const state = startCheckin('Take a five-minute walk');
    invoke.mockResolvedValue({ data: { interpretation }, error: null } as never);
    expect(await interpretTypedCheckinReply(state, 'Skipped it')).toEqual(interpretation);
    expect(invoke).toHaveBeenCalledWith('sleep-coach', { body: {
      mode: 'checkin_reply', checkinReply: { step: 'adherence', message: 'Skipped it', turns: state.turns },
    } });
  });

  it('preserves the original question and recent context without changing stored replies', async () => {
    const state = startCheckin('Take a five-minute walk');
    for (let i = 0; i < 30; i++) state.turns.push({ role: 'user', content: `More detail ${i}` });
    const before = JSON.stringify(state);
    invoke.mockResolvedValue({ data: { interpretation }, error: null } as never);
    await interpretTypedCheckinReply(state, 'Skipped it');
    const turns = invoke.mock.calls[0][1]!.body.checkinReply.turns;
    expect(turns).toHaveLength(20);
    expect(turns[0]).toEqual(state.turns[0]);
    expect(turns.at(-1)).toEqual(state.turns.at(-1));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('leaves the conversation unchanged when the API fails or returns an invalid interpretation', async () => {
    const state = startCheckin('Take a five-minute walk');
    const before = JSON.stringify(state);
    invoke.mockResolvedValueOnce({ data: null, error: new Error('Offline') } as never);
    invoke.mockResolvedValueOnce({ data: { interpretation: { ...interpretation, answer: 'great' } }, error: null } as never);
    invoke.mockResolvedValueOnce({ data: { response: 'Unexpected response from an old function deployment' }, error: null } as never);
    for (let i = 0; i < 3; i++) {
      await expect(interpretTypedCheckinReply(state, 'Skipped it')).rejects.toThrow('try sending again');
      expect(JSON.stringify(state)).toBe(before);
    }
  });
});
