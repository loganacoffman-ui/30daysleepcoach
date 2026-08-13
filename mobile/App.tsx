import { makeRedirectUri } from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';

import { Onboarding } from './Onboarding';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

const redirectTo = makeRedirectUri({
  scheme: 'thirtydaysleepcoach',
  path: 'auth/callback',
});

async function createSessionFromUrl(url: string) {
  const { params, errorCode } = QueryParams.getQueryParams(url);

  if (errorCode) {
    throw new Error(errorCode);
  }

  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;

  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    return;
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    throw error;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function AppContent() {
  const incomingUrl = Linking.useLinkingURL();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingComplete(true);
  }, []);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) {
        return;
      }

      if (error) {
        setMessage(error.message);
      }

      setSession(data.session);
      setInitializing(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    if (AppState.currentState === 'active') {
      supabase.auth.startAutoRefresh();
    }

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      appStateSubscription.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  useEffect(() => {
    if (!incomingUrl) {
      return;
    }

    void createSessionFromUrl(incomingUrl).catch((error: unknown) => {
      setMessage(getErrorMessage(error));
    });
  }, [incomingUrl]);

  useEffect(() => {
    setOnboardingComplete(false);
  }, [session?.user.id]);

  const runAuthAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');

    try {
      await action();
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const signInWithPassword = () =>
    runAuthAction(async () => {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        throw error;
      }
    });

  const createAccount = () =>
    runAuthAction(async () => {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      if (error) {
        throw error;
      }

      if (!data.session) {
        setMessage('Check your email to confirm your account, then sign in.');
      }
    });

  const signInWithGoogle = () =>
    runAuthAction(async () => {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        throw error;
      }

      if (!data.url) {
        throw new Error('Supabase did not return a Google sign-in URL.');
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

      if (result.type === 'success') {
        await createSessionFromUrl(result.url);
      }
    });

  const signOut = () =>
    runAuthAction(async () => {
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }
    });

  if (initializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#5956e9" size="large" />
        <StatusBar style="dark" />
      </View>
    );
  }

  if (session && !onboardingComplete) {
    return (
      <>
        <Onboarding onComplete={handleOnboardingComplete} session={session} />
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Text style={styles.eyebrow}>30 DAY SLEEP COACH</Text>
          <Text style={styles.title}>{session ? 'Welcome back' : 'Sleep better, one day at a time'}</Text>
          <Text style={styles.subtitle}>
            {session
              ? 'You are signed in and ready to continue.'
              : 'Sign in to save your sleep data and coaching progress.'}
          </Text>
        </View>

        <View style={styles.card}>
          {session ? (
            <>
              <Text style={styles.label}>Signed in as</Text>
              <Text style={styles.userEmail}>{session.user.email ?? 'Google user'}</Text>
              <Pressable
                disabled={busy}
                onPress={signOut}
                style={({ pressed }) => [
                  styles.button,
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Sign out</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.label}>Email</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!busy}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#8d8ba3"
                style={styles.input}
                value={email}
              />

              <Text style={styles.label}>Password</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="current-password"
                editable={!busy}
                onChangeText={setPassword}
                onSubmitEditing={signInWithPassword}
                placeholder="Your password"
                placeholderTextColor="#8d8ba3"
                secureTextEntry
                style={styles.input}
                value={password}
              />

              <Pressable
                disabled={busy}
                onPress={signInWithPassword}
                style={({ pressed }) => [
                  styles.button,
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.primaryButtonText}>Sign in</Text>
              </Pressable>

              <Pressable
                disabled={busy}
                onPress={createAccount}
                style={({ pressed }) => [
                  styles.button,
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Create account</Text>
              </Pressable>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.dividerLine} />
              </View>

              <Pressable
                disabled={busy}
                onPress={signInWithGoogle}
                style={({ pressed }) => [
                  styles.button,
                  styles.googleButton,
                  pressed && styles.buttonPressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </Pressable>
            </>
          )}

          {busy && <ActivityIndicator color="#5956e9" style={styles.activity} />}
          {!!message && <Text style={styles.message}>{message}</Text>}
        </View>
      </ScrollView>
      <StatusBar style="dark" />
    </KeyboardAvoidingView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f4ff',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#f5f4ff',
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 64,
  },
  brand: {
    marginBottom: 28,
  },
  eyebrow: {
    color: '#5956e9',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  title: {
    color: '#201f34',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: 40,
    marginBottom: 12,
  },
  subtitle: {
    color: '#68657d',
    fontSize: 16,
    lineHeight: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 22,
    shadowColor: '#312e81',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 20,
    elevation: 4,
  },
  label: {
    color: '#35334b',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f8f7fc',
    borderColor: '#e6e4ef',
    borderRadius: 14,
    borderWidth: 1,
    color: '#201f34',
    fontSize: 16,
    marginBottom: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 52,
    paddingHorizontal: 18,
  },
  primaryButton: {
    backgroundColor: '#5956e9',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#eeedff',
  },
  secondaryButtonText: {
    color: '#4d49c7',
    fontSize: 16,
    fontWeight: '700',
  },
  googleButton: {
    backgroundColor: '#ffffff',
    borderColor: '#d9d7e3',
    borderWidth: 1,
  },
  googleButtonText: {
    color: '#35334b',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonPressed: {
    opacity: 0.78,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  divider: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginVertical: 20,
  },
  dividerLine: {
    backgroundColor: '#e6e4ef',
    flex: 1,
    height: 1,
  },
  dividerText: {
    color: '#8d8ba3',
    fontSize: 11,
    fontWeight: '700',
  },
  activity: {
    marginTop: 18,
  },
  message: {
    color: '#b42318',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 16,
    textAlign: 'center',
  },
  userEmail: {
    color: '#201f34',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 18,
  },
});
