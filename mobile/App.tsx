import * as QueryParams from 'expo-auth-session/build/QueryParams';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import type { Session } from '@supabase/supabase-js';

import { Onboarding } from './Onboarding';
import { supabase } from './supabase';
import { loadSleepProfile } from './onboarding/profileRepository';
import type { SleepProfile } from './onboarding/types';
import ProductApp from './product/ProductApp';

WebBrowser.maybeCompleteAuthSession();

const redirectTo = Linking.createURL('auth/callback');

type AuthCallbackResult = {
  isRecovery: boolean;
};

async function createSessionFromUrl(url: string): Promise<AuthCallbackResult> {
  const { params, errorCode } = QueryParams.getQueryParams(url);

  if (errorCode) {
    const description = params.error_description;
    throw new Error(typeof description === 'string' ? description : errorCode);
  }

  const isRecovery = params.type === 'recovery';
  const authorizationCode = params.code;
  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;

  if (typeof authorizationCode === 'string') {
    const { error } = await supabase.auth.exchangeCodeForSession(authorizationCode);

    if (error) {
      throw error;
    }

    return { isRecovery };
  }

  if (typeof accessToken === 'string' && typeof refreshToken === 'string') {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      throw error;
    }

    return { isRecovery };
  }

  throw new Error('This sign-in link is invalid or has expired. Please request a new one.');
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function AppContent() {
  const incomingUrl = Linking.useLinkingURL();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [appleSignInAvailable, setAppleSignInAvailable] = useState(false);
  const [profile, setProfile] = useState<SleepProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

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
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
        setMessage('Choose a new password for your account.');
      }
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
    if (Platform.OS !== 'ios') {
      return;
    }

    void AppleAuthentication.isAvailableAsync().then(setAppleSignInAvailable);
  }, []);

  useEffect(() => {
    if (!incomingUrl) {
      return;
    }

    void createSessionFromUrl(incomingUrl)
      .then(({ isRecovery }) => {
        if (isRecovery) {
          setRecoveryMode(true);
          setMessage('Choose a new password for your account.');
        }
      })
      .catch((error: unknown) => {
        setMessage(getErrorMessage(error));
      });
  }, [incomingUrl]);

  useEffect(() => {
    let mounted = true;
    if (!session) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    void loadSleepProfile(session.user)
      .then((nextProfile) => { if (mounted) setProfile(nextProfile); })
      .catch((error: unknown) => { if (mounted) setMessage(getErrorMessage(error)); })
      .finally(() => { if (mounted) setProfileLoading(false); });
    return () => { mounted = false; };
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
      if (!email.trim() || !password) {
        throw new Error('Enter your email and password.');
      }

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
      if (!email.trim() || password.length < 8) {
        throw new Error('Enter a valid email and a password with at least 8 characters.');
      }

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
        setMessage(
          'Check your email for the next step. If you already have an account, sign in or reset your password.',
        );
      }
    });

  const requestPasswordReset = () =>
    runAuthAction(async () => {
      if (!email.trim()) {
        throw new Error('Enter your email first.');
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (error) {
        throw error;
      }

      setMessage('If an account matches that email, a password reset link is on the way.');
    });

  const updatePassword = () =>
    runAuthAction(async () => {
      if (newPassword.length < 8) {
        throw new Error('Your new password must be at least 8 characters.');
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword });

      if (error) {
        throw error;
      }

      setNewPassword('');
      setRecoveryMode(false);
      setMessage('Password updated. You are signed in.');
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

  const signInWithApple = () =>
    runAuthAction(async () => {
      try {
        const credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });

        if (!credential.identityToken) {
          throw new Error('Apple did not return a valid identity token. Please try again.');
        }

        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        });

        if (error) {
          throw error;
        }

        if (credential.fullName) {
          const fullName = AppleAuthentication.formatFullName(credential.fullName);

          if (fullName) {
            const { error: updateError } = await supabase.auth.updateUser({
              data: {
                full_name: fullName,
                given_name: credential.fullName.givenName,
                family_name: credential.fullName.familyName,
              },
            });

            if (updateError) {
              throw updateError;
            }
          }
        }
      } catch (error) {
        if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') {
          return;
        }

        throw error;
      }
    });

  const signOut = () =>
    runAuthAction(async () => {
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }
    });

  const deleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account and associated sleep data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => {
            void runAuthAction(async () => {
              const { data, error } = await supabase.functions.invoke('delete-account');

              if (error || !data?.deleted) {
                throw new Error('We could not delete your account. Your account is still active.');
              }

              await supabase.auth.signOut({ scope: 'local' });
              setMessage('Your account has been permanently deleted.');
            });
          },
        },
      ],
    );
  };

  const completeOnboarding = useCallback(async () => {
    if (!session) {
      return;
    }

    const nextProfile = await loadSleepProfile(session.user);
    if (!nextProfile) {
      throw new Error('Your onboarding answers were saved, but the completed profile could not be loaded.');
    }
    setProfile(nextProfile);
  }, [session]);

  if (initializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#4f7cff" size="large" />
        <StatusBar style="dark" />
      </View>
    );
  }

  if (session && !recoveryMode) {
    if (profileLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#4f7cff" size="large" />
          <StatusBar style="dark" />
        </View>
      );
    }

    if (!profile) {
      return (
        <Onboarding
          key={session.user.id}
          onComplete={completeOnboarding}
          session={session}
        />
      );
    }

    return (
      <ProductApp
        busy={busy}
        onDeleteAccount={deleteAccount}
        onSignOut={signOut}
        profile={profile}
        session={session}
      />
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
          {recoveryMode ? (
            <>
              <Text style={styles.label}>New password</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="new-password"
                editable={!busy}
                onChangeText={setNewPassword}
                onSubmitEditing={updatePassword}
                placeholder="At least 8 characters"
                placeholderTextColor="#8d8ba3"
                secureTextEntry
                style={styles.input}
                value={newPassword}
              />
              <Pressable
                disabled={busy}
                onPress={updatePassword}
                style={({ pressed }) => [
                  styles.button,
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.primaryButtonText}>Update password</Text>
              </Pressable>
            </>
          ) : session ? (
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
              <Pressable
                disabled={busy}
                onPress={deleteAccount}
                style={({ pressed }) => [
                  styles.button,
                  styles.deleteButton,
                  pressed && styles.buttonPressed,
                  busy && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.deleteButtonText}>Delete account</Text>
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

              <Pressable disabled={busy} onPress={requestPasswordReset}>
                <Text style={styles.forgotPassword}>Forgot password?</Text>
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

              {appleSignInAvailable && (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  cornerRadius={14}
                  onPress={busy ? () => undefined : signInWithApple}
                  style={[styles.appleButton, busy && styles.buttonDisabled]}
                />
              )}
            </>
          )}

          {busy && <ActivityIndicator color="#4f7cff" style={styles.activity} />}
          {!!message && <Text style={styles.message}>{message}</Text>}
        </View>

        <Text style={styles.healthDisclaimer}>
          Educational sleep coaching only—not medical advice, diagnosis, or treatment. Consult a
          qualified healthcare professional for medical decisions or persistent symptoms.
        </Text>
        <Pressable onPress={() => void Linking.openURL('https://30daysleepcoach.com/privacy.html')}>
          <Text style={styles.privacyLink}>Privacy Policy</Text>
        </Pressable>
      </ScrollView>
      <StatusBar style="dark" />
    </KeyboardAvoidingView>
  );
}

export default function App() {
  return <AppContent />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#fafafa',
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
    color: '#4f7cff',
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
    backgroundColor: '#f4f4f5',
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
    backgroundColor: '#4f7cff',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#f0f4ff',
  },
  secondaryButtonText: {
    color: '#3d6ae8',
    fontSize: 16,
    fontWeight: '700',
  },
  deleteButton: {
    backgroundColor: '#fff5f4',
    borderColor: '#f2b8b5',
    borderWidth: 1,
  },
  deleteButtonText: {
    color: '#b42318',
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
  appleButton: {
    height: 52,
    marginTop: 10,
    width: '100%',
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
  healthDisclaimer: {
    color: '#77738d',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 20,
    textAlign: 'center',
  },
  privacyLink: {
    color: '#3d6ae8',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  forgotPassword: {
    color: '#3d6ae8',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});
