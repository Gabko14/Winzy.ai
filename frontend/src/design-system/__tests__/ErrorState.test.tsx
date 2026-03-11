import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ErrorState } from '../components/ErrorState';

describe('ErrorState', () => {
  it('renders default title and message', () => {
    render(<ErrorState message="Network error" />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Network error')).toBeTruthy();
  });

  it('renders custom title', () => {
    render(<ErrorState title="Oops" message="Try again" />);
    expect(screen.getByText('Oops')).toBeTruthy();
  });

  it('renders retry button and handles press', () => {
    const onRetry = jest.fn();
    render(<ErrorState message="Failed" onRetry={onRetry} />);
    fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render retry button when no handler', () => {
    render(<ErrorState message="Failed" />);
    expect(screen.queryByText('Try again')).toBeNull();
  });
});
