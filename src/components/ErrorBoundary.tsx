import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }}>
        <ScrollView
          contentContainerStyle={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
          }}
        >
          <Text style={{ color: '#FF6B5E', fontSize: 48, marginBottom: 16 }}>!</Text>
          <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' }}>
            Something went wrong
          </Text>
          <Text style={{ color: '#7E9895', fontSize: 14, textAlign: 'center', marginBottom: 32, lineHeight: 20 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <TouchableOpacity
            onPress={this.handleReset}
            style={{
              backgroundColor: '#FFB454',
              paddingHorizontal: 32,
              paddingVertical: 14,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 }}>Try Again</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }
}
