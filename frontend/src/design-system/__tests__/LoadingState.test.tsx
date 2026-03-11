import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { LoadingState } from '../components/LoadingState';

describe('LoadingState', () => {
  it('renders without message', () => {
    render(<LoadingState />);
    expect(screen.getByTestId('loading-state')).toBeTruthy();
  });

  it('renders with message', () => {
    render(<LoadingState message="Loading habits..." />);
    expect(screen.getByText('Loading habits...')).toBeTruthy();
  });
});
