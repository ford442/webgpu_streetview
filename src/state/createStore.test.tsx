// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createStore, useStore } from './createStore';

describe('createStore', () => {
    it('notifies on a change and not on a no-op set', () => {
        const store = createStore({ a: 1, b: 'x' });
        const listener = vi.fn();
        store.subscribe(listener);
        store.set({ a: 1, b: 'x' });
        store.set((s) => s);
        expect(listener).not.toHaveBeenCalled();
        store.set((s) => ({ ...s, a: 2 }));
        expect(listener).toHaveBeenCalledTimes(1);
        expect(store.get()).toEqual({ a: 2, b: 'x' });
    });

    it('lets a listener unsubscribe mid-notify without skipping a peer', () => {
        const store = createStore(0);
        const second = vi.fn();
        const unsubscribe = store.subscribe(() => unsubscribe());
        store.subscribe(second);
        store.set(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('re-renders a component only when its selected value changes', () => {
        const store = createStore({ hot: 0, cold: 'a' });
        const renders = vi.fn();
        const Cold = () => {
            renders(useStore(store, (s) => s.cold));
            return null;
        };
        render(<Cold />);
        act(() => {
            for (let i = 1; i <= 50; i++) store.set((s) => ({ ...s, hot: i }));
        });
        expect(renders).toHaveBeenCalledTimes(1);
        act(() => store.set((s) => ({ ...s, cold: 'b' })));
        expect(renders).toHaveBeenLastCalledWith('b');
    });
});
