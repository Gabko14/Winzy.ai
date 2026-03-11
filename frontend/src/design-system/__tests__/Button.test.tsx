import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Button } from '../components/Button';

describe('Button', () => {
  it('renders with title text', () => {
    render(<Button title="Press me" onPress={jest.fn()} />);
    expect(screen.getByText('Press me')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    render(<Button title="Click" onPress={onPress} />);
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const onPress = jest.fn();
    render(<Button title="Click" onPress={onPress} disabled />);
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows ActivityIndicator when loading', () => {
    render(<Button title="Submit" onPress={jest.fn()} loading />);
    // When loading, title text should not be visible
    expect(screen.queryByText('Submit')).toBeNull();
  });

  it('does not call onPress when loading', () => {
    const onPress = jest.fn();
    render(<Button title="Submit" onPress={onPress} loading />);
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('uses custom accessibilityLabel when provided', () => {
    render(
      <Button
        title="OK"
        onPress={jest.fn()}
        accessibilityLabel="Confirm action"
      />,
    );
    expect(screen.getByLabelText('Confirm action')).toBeTruthy();
  });

  it('uses title as accessibilityLabel by default', () => {
    render(<Button title="Save" onPress={jest.fn()} />);
    expect(screen.getByLabelText('Save')).toBeTruthy();
  });
});
