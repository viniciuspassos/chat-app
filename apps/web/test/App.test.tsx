import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';

describe('App', () => {
  it('renders the chat application shell', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Chat Assistant' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Conversation' })).toBeInTheDocument();
  });
});
