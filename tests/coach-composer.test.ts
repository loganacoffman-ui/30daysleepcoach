import { describe, expect, it, vi } from 'vitest';
import ChatComposer from '../mobile/coach/ChatComposer';

// Inspect the rendered native-element contract without a device or live account.
vi.mock('../mobile/node_modules/react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text',
  TextInput: 'TextInput', View: 'View', StyleSheet: { create: (styles: unknown) => styles },
}));

function elements(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}

function composer(overrides = {}) {
  const onChangeText = vi.fn();
  const onSend = vi.fn();
  const render = (ChatComposer as any).render as (props: unknown, ref: null) => unknown;
  const tree = elements(render({ value: '', onChangeText, onSend, ...overrides }, null));
  return {
    input: tree.find(node => node.type === 'TextInput').props,
    send: tree.find(node => node.type === 'Pressable').props,
    tree, onChangeText, onSend,
  };
}

describe('Tell Coach composer', () => {
  it('invites sharing in an empty conversation and blocks blank submission', () => {
    const { input, send } = composer();
    expect(input.placeholder).toBe('Tell Coach…');
    expect(input.accessibilityLabel).toBe('Tell Coach');
    expect(input.accessibilityHint).toContain('habits, recent life context, or questions');
    expect(input.editable).toBe(true);
    expect(send.disabled).toBe(true);
    expect(composer({ value: ' \n ' }).send.disabled).toBe(true);
  });

  it('preserves editing and sending a follow-up in a populated conversation', () => {
    const { input, send, onChangeText, onSend } = composer({ value: 'My routine changed this week.' });
    expect(input.placeholder).toBe('Tell Coach…');
    expect(input.value).toBe('My routine changed this week.');
    expect(input.multiline).toBe(true);
    expect(input.submitBehavior).toBe('newline');
    expect(input.maxLength).toBe(4000);
    input.onChangeText('I have been traveling.');
    expect(onChangeText).toHaveBeenCalledWith('I have been traveling.');
    expect(send.disabled).toBe(false);
    send.onPress();
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('preserves loading and sending guards and accessible errors', () => {
    const busy = composer({ value: 'A follow-up', disabled: true, error: 'Try again' });
    expect(busy.input.editable).toBe(false);
    expect(busy.send.accessibilityState.disabled).toBe(true);
    expect(busy.tree.find(node => node.props?.accessibilityRole === 'alert').props.children).toBe('Try again');
    const sending = composer({ value: 'Another thought', sending: true });
    expect(sending.send.disabled).toBe(true);
    expect(sending.tree.some(node => node.type === 'ActivityIndicator')).toBe(true);
  });

  it('keeps guided check-in placeholders when supplied', () => {
    expect(composer({ placeholder: 'Reply or add more detail…' }).input.placeholder).toBe('Reply or add more detail…');
  });
});
