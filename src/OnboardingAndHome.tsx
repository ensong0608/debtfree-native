import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import type { Session } from '@supabase/supabase-js';
import {
  AI_REFERRAL_SOURCE,
  COUNTRY_OPTIONS,
  DEBT_CATEGORIES,
  PAY_FREQUENCY_OPTIONS,
  REFERRAL_SOURCES,
  SIGNUP_GOALS,
  calculatePayoffPlan,
  calculateTotalMonthlyIncome,
  formatCurrency,
  normalizeMonthlyIncome,
  parseMoneyInput,
  validateDebtDraft,
  validateDebtsStep,
  validateExtraPaymentInput,
  validateIncomeStep,
  validateSignUpStep2,
  validateSignUpStep3,
  validateSignUpStep4,
  type AdditionalIncomeSource,
  type CountryCode,
  type DebtCategory,
  type DebtItem,
  type FlowStage,
  type HomeOwnershipStatus,
  type PayFrequency,
  type PayoffStrategy,
  type PremiumPlanChoice,
  type UserOnboardingData,
  type VehicleOwnershipStatus,
} from './onboarding-domain';
import {
  deleteUserDebt,
  requestNativeNotificationPermission,
  saveUserOnboardingData,
  upsertUserDebt,
} from './onboarding-storage';
import { AppIcon } from './components/AppIcon';
import { Bar, Card, SnapshotCard, ui } from './components/FinancialScreen';
import { FiveTabShell } from './FiveTabShell';
import { DebtScreen } from './screens/DebtScreen';
import { TransactionsScreen } from './screens/TransactionsScreen';
import { BudgetScreen } from './screens/BudgetScreen';
import { ProgressScreen } from './screens/ProgressScreen';

type Props = {
  session: Session | null;
  onboardingData: UserOnboardingData | null;
  stage: FlowStage;
  onChangeStage: (next: FlowStage) => void;
  onUpdateOnboardingData: (next: UserOnboardingData) => void;
  onGoogleSignIn: () => Promise<Session | null>;
  onAppleSignIn: () => Promise<Session | null>;
  onSignOut: () => Promise<void>;
  appleAvailable: boolean;
  configured: boolean;
  configProblem: string | null;
  authBusy: boolean;
  authError: string;
  authNotice: string;
  onClearAuthError: () => void;
};

function AppleMark() {
  return (
    <View style={styles.appleMarkBox}>
      <View style={styles.appleMarkLeaf} />
      <View style={styles.appleMarkBody}>
        <View style={styles.appleMarkLobeLeft} />
        <View style={styles.appleMarkLobeRight} />
        <View style={styles.appleMarkBite} />
      </View>
    </View>
  );
}

function ProgressHeader({
  label,
  step,
  total,
  onBack,
}: {
  label: string;
  step: number;
  total: number;
  onBack?: () => void;
}) {
  return (
    <View style={styles.topBar}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={styles.backButton}
          onPress={onBack}
        >
          <AppIcon name="back" size={22} color="#F1F1F0" />
        </Pressable>
      ) : null}
      <Text style={styles.stepText} accessibilityRole="header">
        {`${label} ${step} of ${total}`}
      </Text>
      <View style={styles.progressRow} accessible accessibilityLabel={`${label} ${step} of ${total}`}>
        {Array.from({ length: total }, (_, idx) => (
          <View
            key={idx}
            style={[styles.progressSegment, idx < step && styles.progressSegmentDone]}
          />
        ))}
      </View>
    </View>
  );
}

function ChoiceButton({
  label,
  selected,
  onPress,
  compact = false,
  flex = false,
  pill = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
  flex?: boolean;
  pill?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[
        styles.choice,
        compact && styles.choiceCompact,
        flex && styles.choiceFlex,
        pill && styles.choicePill,
        pill && selected && styles.choicePillSelected,
        selected && styles.choiceSelected,
      ]}
      onPress={onPress}
    >
      {selected ? (
        <View style={[styles.choiceCheck, compact && styles.choiceCheckCompact]}>
          <AppIcon name="check" size={compact ? 12 : 14} color="#FF9367" />
        </View>
      ) : null}
      <Text
        style={[
          styles.choiceText,
          compact && styles.choiceTextCompact,
          selected && styles.choiceTextSelected,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function DebtFreeFlow({
  session,
  onboardingData,
  stage,
  onChangeStage,
  onUpdateOnboardingData,
  onGoogleSignIn,
  onAppleSignIn,
  onSignOut,
  appleAvailable,
  configured,
  configProblem,
  authBusy,
  authError,
  authNotice,
  onClearAuthError,
}: Props) {
  const [signInMode, setSignInMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState('');
  const savingRef = useRef(false);

  // Step 4 Country picker toggle
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  // Onboarding Step 1 (Income) local text state
  const [incomeInput, setIncomeInput] = useState(() =>
    onboardingData && onboardingData.primaryIncomeAmount > 0
      ? onboardingData.primaryIncomeAmount.toFixed(2)
      : '5200.00',
  );
  const [showAddIncomeForm, setShowAddIncomeForm] = useState(false);
  const [extraIncomeName, setExtraIncomeName] = useState('');
  const [extraIncomeAmount, setExtraIncomeAmount] = useState('');
  const [extraIncomeFreq, setExtraIncomeFreq] = useState<PayFrequency>('monthly');

  // Onboarding Step 3 / Home (Add/Edit Debt) form state
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null);
  const [showDebtForm, setShowDebtForm] = useState(false);
  const [debtCategory, setDebtCategory] = useState<DebtCategory>('Credit card');
  const [debtName, setDebtName] = useState('');
  const [debtBalance, setDebtBalance] = useState('');
  const [debtOriginalBalance, setDebtOriginalBalance] = useState('');
  const [debtApr, setDebtApr] = useState('');
  const [debtMinimum, setDebtMinimum] = useState('');
  const [debtDueDay, setDebtDueDay] = useState('');
  const [debtCreditLimit, setDebtCreditLimit] = useState('');

  // Onboarding Step 4 (Payoff strategy) extra monthly payment input
  const [extraPaymentInput, setExtraPaymentInput] = useState(() =>
    onboardingData ? onboardingData.extraMonthlyPayment.toFixed(2) : '150.00',
  );

  const countryInfo = useMemo(() => {
    const code = onboardingData?.countryCode ?? 'US';
    return COUNTRY_OPTIONS.find(c => c.code === code) ?? COUNTRY_OPTIONS[0];
  }, [onboardingData?.countryCode]);

  const currencySymbol = countryInfo.symbol;

  const payoffPlan = useMemo(() => {
    if (!onboardingData) return null;
    const parsedExtra = parseMoneyInput(extraPaymentInput);
    const effectiveExtra =
      stage === 'onboard_4' && parsedExtra !== null
        ? parsedExtra
        : onboardingData.extraMonthlyPayment;
    return calculatePayoffPlan(onboardingData.debts, onboardingData.strategy, effectiveExtra);
  }, [onboardingData, extraPaymentInput, stage]);

  const clearErrors = () => {
    setLocalError('');
    if (authError) onClearAuthError();
  };

  const persistAndMove = async (
    patch: Partial<UserOnboardingData>,
    nextStage: FlowStage,
  ) => {
    if (!onboardingData || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setLocalError('');
    try {
      const updated = await saveUserOnboardingData({
        ...onboardingData,
        ...patch,
        currentStage: nextStage,
      });
      onUpdateOnboardingData(updated);
      onChangeStage(nextStage);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to save your progress. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const openNewDebtEditor = (category: DebtCategory) => {
    clearErrors();
    const existingForUniqueType =
      category === 'Mortgage' || category === 'Auto loan'
        ? onboardingData?.debts.find(d => d.category === category)
        : undefined;

    if (existingForUniqueType) {
      openEditDebtEditor(existingForUniqueType);
      return;
    }

    setEditingDebtId(null);
    setDebtCategory(category);
    setDebtName(
      category === 'Mortgage'
        ? 'Home Mortgage'
        : category === 'Auto loan'
          ? 'Auto Loan'
          : '',
    );
    setDebtBalance('');
    setDebtOriginalBalance('');
    setDebtApr('');
    setDebtMinimum('');
    setDebtDueDay('');
    setDebtCreditLimit('');
    setShowDebtForm(true);
  };

  const openEditDebtEditor = (item: DebtItem) => {
    clearErrors();
    setEditingDebtId(item.id);
    setDebtCategory(item.category);
    setDebtName(item.name);
    setDebtBalance(item.balance.toFixed(2));
    setDebtOriginalBalance(item.originalBalance !== null ? item.originalBalance.toFixed(2) : '');
    setDebtApr(String(item.apr));
    setDebtMinimum(item.minimumPayment.toFixed(2));
    setDebtDueDay(item.dueDay !== null ? String(item.dueDay) : '');
    setDebtCreditLimit(item.creditLimit !== null ? item.creditLimit.toFixed(2) : '');
    setShowDebtForm(true);
  };

  const handleSaveDebt = async () => {
    if (!onboardingData || savingRef.current) return;
    clearErrors();
    const validation = validateDebtDraft({
      name: debtName,
      category: debtCategory,
      balanceRaw: debtBalance,
      originalBalanceRaw: debtOriginalBalance,
      aprRaw: debtApr,
      minimumPaymentRaw: debtMinimum,
      dueDayRaw: debtDueDay,
      creditLimitRaw: debtCreditLimit,
    });
    if (!validation.valid) {
      setLocalError(validation.error);
      return;
    }

    // Prevent duplicate rapid creation of identical debt name + category when not editing
    if (
      !editingDebtId &&
      onboardingData.debts.some(
        d =>
          d.name.toLowerCase() === validation.debt.name.toLowerCase() &&
          d.category === validation.debt.category,
      )
    ) {
      setLocalError(`"${validation.debt.name}" is already in your debt list.`);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await upsertUserDebt(onboardingData, {
        id: editingDebtId ?? undefined,
        ...validation.debt,
      });
      onUpdateOnboardingData(updated);
      setShowDebtForm(false);
      setEditingDebtId(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to save debt account.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDeleteDebt = async (debtId: string) => {
    if (!onboardingData || savingRef.current) return;
    clearErrors();
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await deleteUserDebt(onboardingData, debtId);
      onUpdateOnboardingData(updated);
      if (editingDebtId === debtId) {
        setShowDebtForm(false);
        setEditingDebtId(null);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to remove debt account.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // ============================================================================
  // SCREEN 01: WELCOME SCREEN (signup_01.png)
  // ============================================================================
  if (stage === 'welcome') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.welcomeScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.logoRow}>
            <View style={styles.logoBrand} accessible accessibilityRole="header" accessibilityLabel="DebtFree">
              <View style={styles.brandMark}>
                <AppIcon name="brandRise" size={16} color="#FFFFFF" />
              </View>
              <Text style={styles.logoText}>
                Debt<Text style={styles.logoTextAccent}>Free</Text>
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              hitSlop={10}
              onPress={() => {
                clearErrors();
                setSignInMode(true);
                onChangeStage('signup_1');
              }}
            >
              <Text style={styles.topSignInLink}>SIGN IN</Text>
            </Pressable>
          </View>

          <View style={styles.heroSection}>
            <View style={[styles.floatingCard, styles.floatingCardLeft]}>
              <Text style={styles.floatingCardLabel}>Monthly payments</Text>
              <Text style={styles.floatingCardValue}>$1,250</Text>
            </View>

            <View style={styles.orbitContainer}>
              <View style={styles.orbitBase} />
              <View style={styles.orbitArcTeal} />
              <View style={styles.orbitArcTerracotta} />
              <View style={styles.orbitCenter}>
                <Text style={styles.heroBigText}>42%</Text>
                <Text style={styles.heroMiniText}>debt payoff progress</Text>
              </View>
            </View>

            <View style={[styles.floatingCard, styles.floatingCardRight]}>
              <Text style={styles.floatingCardLabel}>{"You're making progress"}</Text>
              <View style={styles.floatingCardValueRow}>
                <AppIcon name="trendDown" size={14} color="#73D9C6" />
                <Text style={[styles.floatingCardValue, { marginTop: 0 }]}>$325 this month</Text>
              </View>
            </View>
          </View>

          <View style={styles.welcomeCopy}>
            <View style={styles.badgeSmall}>
              <Text style={styles.badgeSmallText}>BUILT FOR YOUR DEBT-FREE JOURNEY</Text>
            </View>
            <Text style={styles.welcomeTitle} accessibilityRole="header">
              {'Take control.\nPay off debt.'}
            </Text>
            <Text style={styles.welcomeSubtitle}>
              Bring your balances, bills and payoff plan together in one clear place.
            </Text>
          </View>

          <View style={styles.spacer} />

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Get started"
              style={[styles.primaryButton, styles.primaryButtonHot]}
              onPress={() => {
                clearErrors();
                setSignInMode(false);
                onChangeStage('signup_1');
              }}
            >
              <Text style={styles.primaryButtonText}>Get started</Text>
            </Pressable>

            <View style={styles.footerInlineRow}>
              <Text style={styles.footerNoteText}>Already have an account? </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign in to existing account"
                onPress={() => {
                  clearErrors();
                  setSignInMode(true);
                  onChangeStage('signup_1');
                }}
              >
                <Text style={styles.linkText}>Sign in</Text>
              </Pressable>
            </View>

            <Text style={styles.legalNote}>
              By continuing you agree to our Terms & Privacy Policy.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 02: SIGN-UP STEP 1 OF 4 â€” CREATE ACCOUNT / SIGN IN (signup_02.png)
  // ============================================================================
  if (stage === 'signup_1') {
    const googleDisabled = authBusy || !configured;
    const isSignedIn = Boolean(session?.user);

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Step"
          step={1}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('welcome');
          }}
        />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={styles.introBox}>
            <Text style={styles.introTitle} accessibilityRole="header">
              {signInMode ? 'Welcome back' : 'Create your account'}
            </Text>
            <Text style={styles.introSubtitle}>
              Securely sign in to save your balances and progress across devices.
            </Text>
          </View>

          {!configured ? (
            <View style={styles.calloutOrange}>
              <Text style={styles.calloutOrangeText} accessibilityRole="alert">
                A separate test sign-in service has not been configured yet.
              </Text>
              {__DEV__ && !!configProblem ? (
                <Text style={styles.helpText}>{configProblem}</Text>
              ) : null}
            </View>
          ) : null}

          {!!authNotice ? (
            <View style={styles.calloutTeal}>
              <Text style={styles.calloutTealText} accessibilityLiveRegion="polite">
                {authNotice}
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              authBusy
                ? 'Signing in with Google'
                : isSignedIn
                  ? 'Connected with Google â€” tap to switch account'
                  : 'Continue with Google'
            }
            accessibilityState={{ disabled: googleDisabled, busy: authBusy }}
            disabled={googleDisabled}
            style={[
              styles.providerButton,
              isSignedIn && styles.providerButtonConnected,
              googleDisabled && styles.disabledButton,
            ]}
            onPress={() => {
              clearErrors();
              void onGoogleSignIn();
            }}
          >
            {authBusy ? (
              <ActivityIndicator color="#58CBD0" />
            ) : (
              <>
                <Text style={styles.googleLetterIcon}>G</Text>
                <Text style={styles.providerButtonText}>
                  {isSignedIn ? 'Connected with Google' : 'Continue with Google'}
                </Text>
              </>
            )}
          </Pressable>

          {appleAvailable && configured ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
              cornerRadius={9}
              style={[styles.appleNativeButton, authBusy && styles.disabledButton]}
              onPress={() => {
                if (!authBusy) {
                  clearErrors();
                  void onAppleSignIn();
                }
              }}
            />
          ) : (
            <View style={[styles.providerButton, styles.providerButtonPassive]}>
              <AppleMark />
              <Text style={styles.providerButtonText}>Continue with Apple</Text>
            </View>
          )}

          <Text style={[styles.helpText, styles.textCenter]}>
            Apple sign-in appears only on supported devices.
          </Text>

          <View style={styles.hlineRow}>
            <View style={styles.hlineBar} />
            <Text style={styles.hlineLabel}>SECURE SIGN-IN</Text>
            <View style={styles.hlineBar} />
          </View>

          <View style={styles.calloutTeal}>
            <Text style={styles.calloutTealText}>
              Your financial details remain private. You decide what to add to DebtFree.
            </Text>
          </View>

          <View style={[styles.footerInlineRow, { marginTop: 24 }]}>
            <Text style={styles.helpText}>
              {signInMode ? 'Need to set up a new account? ' : 'Already have an account? '}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={signInMode ? 'Switch to Create account' : 'Switch to Sign in'}
              onPress={() => {
                clearErrors();
                setSignInMode(prev => !prev);
                if (!isSignedIn && !authBusy && configured) {
                  void onGoogleSignIn();
                }
              }}
            >
              <Text style={styles.linkText}>{signInMode ? 'Create account' : 'Sign in'}</Text>
            </Pressable>
          </View>

          {!!authError || !!localError ? (
            <Text style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="assertive">
              {localError || authError}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            accessibilityState={{ disabled: googleDisabled, busy: authBusy }}
            disabled={googleDisabled}
            style={[styles.primaryButton, googleDisabled && styles.disabledButton]}
            onPress={() => {
              clearErrors();
              if (isSignedIn) {
                onChangeStage(
                  onboardingData?.onboardingCompleted ? 'home' : 'signup_2',
                );
              } else {
                void onGoogleSignIn();
              }
            }}
          >
            <Text style={styles.primaryButtonText}>Continue</Text>
          </Pressable>
          <Text style={styles.footerNoteText}>
            Connect an account to continue. No bank connection required.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Require loaded onboardingData for all authenticated steps (signup_2..home)
  if (!onboardingData) {
    return (
      <SafeAreaView style={[styles.root, styles.centered]} edges={['top', 'bottom', 'left', 'right']}>
        <ActivityIndicator size="large" color="#58CBD0" />
        <Text style={[styles.helpText, { marginTop: 12 }]}>Loading your account setupâ€¦</Text>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 03: SIGN-UP STEP 2 OF 4 â€” YOUR GOALS (signup_03.png)
  // ============================================================================
  if (stage === 'signup_2') {
    const toggleGoal = (goal: string) => {
      clearErrors();
      const exists = onboardingData.goals.includes(goal);
      const nextGoals = exists
        ? onboardingData.goals.filter(g => g !== goal)
        : [...onboardingData.goals, goal];
      onUpdateOnboardingData({ ...onboardingData, goals: nextGoals });
    };

    const handleContinueStep2 = () => {
      const err = validateSignUpStep2(onboardingData.goals);
      if (err) {
        setLocalError(err);
        return;
      }
      void persistAndMove({ goals: onboardingData.goals }, 'signup_3');
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Step"
          step={2}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('signup_1');
          }}
        />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={styles.introBox}>
            <Text style={styles.introTitle} accessibilityRole="header">
              What brings you to DebtFree?
            </Text>
            <Text style={styles.introSubtitle}>
              Choose what matters most. Weâ€™ll use it to tailor your experience.
            </Text>
          </View>

          {SIGNUP_GOALS.map(goal => (
            <ChoiceButton
              key={goal}
              label={goal}
              selected={onboardingData.goals.includes(goal)}
              onPress={() => toggleGoal(goal)}
            />
          ))}

          <Text style={[styles.helpText, styles.textCenter, { marginTop: 12 }]}>
            You can select more than one.
          </Text>

          {!!localError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {localError}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleContinueStep2}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 04: SIGN-UP STEP 3 OF 4 â€” HOW YOU FOUND US (signup_04.png)
  // ============================================================================
  if (stage === 'signup_3') {
    const isAiSelected = onboardingData.referralSource === AI_REFERRAL_SOURCE;

    const handleContinueStep3 = () => {
      const err = validateSignUpStep3(
        onboardingData.referralSource,
        onboardingData.consideredBeforeAi,
      );
      if (err) {
        setLocalError(err);
        return;
      }
      void persistAndMove(
        {
          referralSource: onboardingData.referralSource,
          consideredBeforeAi: isAiSelected ? onboardingData.consideredBeforeAi : null,
        },
        'signup_4',
      );
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Step"
          step={3}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('signup_2');
          }}
        />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.introBox, styles.introCompact]}>
            <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">
              How did you hear about DebtFree?
            </Text>
            <Text style={styles.introSubtitle}>
              Your answer helps us understand what brought you here.
            </Text>
          </View>

          {REFERRAL_SOURCES.map(source => (
            <ChoiceButton
              key={source}
              label={source}
              selected={onboardingData.referralSource === source}
              onPress={() => {
                clearErrors();
                onUpdateOnboardingData({
                  ...onboardingData,
                  referralSource: source,
                  consideredBeforeAi:
                    source === AI_REFERRAL_SOURCE
                      ? onboardingData.consideredBeforeAi ?? 'no'
                      : null,
                });
              }}
            />
          ))}

          {isAiSelected ? (
            <View style={styles.calloutOrange}>
              <Text style={styles.calloutOrangeTitle}>If you chose AI</Text>
              <Text style={styles.calloutOrangeText}>
                Were you considering DebtFree before asking an AI assistant?
              </Text>
              <View style={[styles.choiceGrid2, { marginTop: 10 }]}>
                <ChoiceButton
                  label="Yes"
                  flex
                  selected={onboardingData.consideredBeforeAi === 'yes'}
                  onPress={() => {
                    clearErrors();
                    onUpdateOnboardingData({ ...onboardingData, consideredBeforeAi: 'yes' });
                  }}
                />
                <ChoiceButton
                  label="No"
                  flex
                  selected={onboardingData.consideredBeforeAi === 'no'}
                  onPress={() => {
                    clearErrors();
                    onUpdateOnboardingData({ ...onboardingData, consideredBeforeAi: 'no' });
                  }}
                />
              </View>
            </View>
          ) : null}

          {!!localError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {localError}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleContinueStep3}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 05: SIGN-UP STEP 4 OF 4 â€” ABOUT YOU (signup_05.png)
  // ============================================================================
  if (stage === 'signup_4') {
    const handleStartOnboarding = () => {
      const err = validateSignUpStep4(
        onboardingData.managesWithPartner,
        onboardingData.worksWithProfessional,
      );
      if (err) {
        setLocalError(err);
        return;
      }
      void persistAndMove(
        {
          countryCode: onboardingData.countryCode,
          managesWithPartner: onboardingData.managesWithPartner,
          worksWithProfessional: onboardingData.worksWithProfessional,
          signupCompleted: true,
        },
        'onboard_1',
      );
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Step"
          step={4}
          total={4}
          onBack={() => {
            clearErrors();
            onChangeStage('signup_3');
          }}
        />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={styles.introBox}>
            <Text style={styles.introTitle} accessibilityRole="header">
              Tell us about yourself
            </Text>
            <Text style={styles.introSubtitle}>
              A few details help us build the right setup for you.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Country and currency: ${countryInfo.label}`}
            style={styles.countrySelector}
            onPress={() => setShowCountryPicker(prev => !prev)}
          >
            <Text style={styles.countryFlagText}>{countryInfo.flag}</Text>
            <AppIcon name="chevronDown" size={16} color="#AAAAAA" />
          </Pressable>

          {showCountryPicker ? (
            <View style={styles.countryDropdown}>
              {COUNTRY_OPTIONS.map(opt => (
                <ChoiceButton
                  key={opt.code}
                  label={`${opt.flag}  ${opt.label}`}
                  selected={onboardingData.countryCode === opt.code}
                  onPress={() => {
                    onUpdateOnboardingData({
                      ...onboardingData,
                      countryCode: opt.code as CountryCode,
                    });
                    setShowCountryPicker(false);
                  }}
                />
              ))}
            </View>
          ) : null}

          <Text style={styles.fieldLabel}>Do you manage finances with a partner?</Text>
          <View style={styles.choiceGrid2}>
            <ChoiceButton
              label="Yes"
              flex
              selected={onboardingData.managesWithPartner === true}
              onPress={() => {
                clearErrors();
                onUpdateOnboardingData({ ...onboardingData, managesWithPartner: true });
              }}
            />
            <ChoiceButton
              label="No"
              flex
              selected={onboardingData.managesWithPartner === false}
              onPress={() => {
                clearErrors();
                onUpdateOnboardingData({ ...onboardingData, managesWithPartner: false });
              }}
            />
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 24 }]}>
            Do you work with a financial professional?
          </Text>
          <View style={styles.choiceGrid2}>
            <ChoiceButton
              label="Yes"
              flex
              selected={onboardingData.worksWithProfessional === true}
              onPress={() => {
                clearErrors();
                onUpdateOnboardingData({ ...onboardingData, worksWithProfessional: true });
              }}
            />
            <ChoiceButton
              label="No"
              flex
              selected={onboardingData.worksWithProfessional === false}
              onPress={() => {
                clearErrors();
                onUpdateOnboardingData({ ...onboardingData, worksWithProfessional: false });
              }}
            />
          </View>

          <View style={[styles.calloutTeal, { marginTop: 28 }]}>
            <Text style={styles.calloutTealText}>
              Next, weâ€™ll personalize your debt payoff plan in five short steps.
            </Text>
          </View>

          {!!localError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {localError}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start onboarding"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleStartOnboarding}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Start onboarding</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 06: ONBOARDING SETUP 1 OF 5 â€” INCOME (onboard_01.png)
  // ============================================================================
  if (stage === 'onboard_1') {
    const parsedPrimary = parseMoneyInput(incomeInput) ?? 0;
    const primaryMonthly = normalizeMonthlyIncome(
      parsedPrimary,
      onboardingData.primaryPayFrequency,
    );
    const totalMonthlyIncome = calculateTotalMonthlyIncome(
      parsedPrimary,
      onboardingData.primaryPayFrequency,
      onboardingData.additionalIncomes,
    );

    const handleAddExtraIncome = () => {
      clearErrors();
      const nameTrimmed = extraIncomeName.trim();
      if (!nameTrimmed) {
        setLocalError('Enter a name for the additional income source (for example, Partner income).');
        return;
      }
      const parsedAmt = parseMoneyInput(extraIncomeAmount);
      if (parsedAmt === null || parsedAmt <= 0) {
        setLocalError('Enter an income amount greater than $0.');
        return;
      }
      const newSource: AdditionalIncomeSource = {
        id: Crypto.randomUUID(),
        name: nameTrimmed,
        amount: parsedAmt,
        frequency: extraIncomeFreq,
        monthlyAmount: normalizeMonthlyIncome(parsedAmt, extraIncomeFreq),
      };
      onUpdateOnboardingData({
        ...onboardingData,
        additionalIncomes: [...onboardingData.additionalIncomes, newSource],
      });
      setExtraIncomeName('');
      setExtraIncomeAmount('');
      setExtraIncomeFreq('monthly');
      setShowAddIncomeForm(false);
    };

    const handleRemoveExtraIncome = (id: string) => {
      clearErrors();
      onUpdateOnboardingData({
        ...onboardingData,
        additionalIncomes: onboardingData.additionalIncomes.filter(s => s.id !== id),
      });
    };

    const handleContinueIncome = () => {
      const check = validateIncomeStep(incomeInput, onboardingData.additionalIncomes);
      if (!check.valid) {
        setLocalError(check.error);
        return;
      }
      const monthly = normalizeMonthlyIncome(
        check.primaryAmount,
        onboardingData.primaryPayFrequency,
      );
      void persistAndMove(
        {
          primaryIncomeAmount: check.primaryAmount,
          primaryPayFrequency: onboardingData.primaryPayFrequency,
          primaryMonthlyIncome: monthly,
          additionalIncomes: onboardingData.additionalIncomes,
        },
        'onboard_2',
      );
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={1}
          total={5}
          onBack={() => {
            clearErrors();
            onChangeStage('signup_4');
          }}
        />
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
            <View style={styles.introBox}>
              <Text style={styles.introTitle} accessibilityRole="header">
                Letâ€™s start with your income
              </Text>
              <Text style={styles.introSubtitle}>
                What is your monthly take-home income, after taxes?
              </Text>
            </View>

            <Text style={styles.fieldLabel}>Monthly take-home income</Text>
            <View style={styles.bigFieldBox}>
              <Text style={styles.bigFieldPrefix}>{currencySymbol}</Text>
              <TextInput
                accessibilityLabel="Take-home income amount"
                style={styles.bigFieldInput}
                keyboardType="decimal-pad"
                value={incomeInput}
                onChangeText={text => {
                  clearErrors();
                  setIncomeInput(text);
                }}
                placeholder="5,200.00"
                placeholderTextColor="#6E7571"
              />
              <Text style={styles.fieldMutedUnit}>{countryInfo.currency}</Text>
            </View>
            <Text style={styles.helpText}>
              {onboardingData.primaryPayFrequency === 'monthly'
                ? `Monthly equivalent: ${formatCurrency(primaryMonthly, currencySymbol)}`
                : `${formatCurrency(parsedPrimary, currencySymbol)} (${
                    PAY_FREQUENCY_OPTIONS.find(o => o.value === onboardingData.primaryPayFrequency)
                      ?.label ?? ''
                  }) = ${formatCurrency(primaryMonthly, currencySymbol)} / month`}
            </Text>

            <Text style={styles.fieldLabel}>How often are you paid?</Text>
            <View style={styles.choiceGrid2}>
              {PAY_FREQUENCY_OPTIONS.slice(0, 2).map(opt => (
                <ChoiceButton
                  key={opt.value}
                  label={opt.label}
                  flex
                  selected={onboardingData.primaryPayFrequency === opt.value}
                  onPress={() => {
                    clearErrors();
                    onUpdateOnboardingData({
                      ...onboardingData,
                      primaryPayFrequency: opt.value,
                    });
                  }}
                />
              ))}
            </View>
            <View style={[styles.choiceGrid2, { marginTop: 8 }]}>
              {PAY_FREQUENCY_OPTIONS.slice(2, 4).map(opt => (
                <ChoiceButton
                  key={opt.value}
                  label={opt.label}
                  flex
                  selected={onboardingData.primaryPayFrequency === opt.value}
                  onPress={() => {
                    clearErrors();
                    onUpdateOnboardingData({
                      ...onboardingData,
                      primaryPayFrequency: opt.value,
                    });
                  }}
                />
              ))}
            </View>

            <Text style={styles.sectionTitle}>Other household income</Text>
            {onboardingData.additionalIncomes.map(source => (
              <View key={source.id} style={styles.addedItemCard}>
                <View style={styles.flex1}>
                  <Text style={styles.addedItemTitle}>{source.name}</Text>
                  <Text style={styles.addedItemSub}>
                    {`${formatCurrency(source.amount, currencySymbol)} (${
                      PAY_FREQUENCY_OPTIONS.find(f => f.value === source.frequency)?.label ??
                      source.frequency
                    }) â†’ ${formatCurrency(
                      normalizeMonthlyIncome(source.amount, source.frequency),
                      currencySymbol,
                    )}/mo`}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${source.name}`}
                  onPress={() => handleRemoveExtraIncome(source.id)}
                >
                  <Text style={styles.removeActionText}>Remove</Text>
                </Pressable>
              </View>
            ))}

            {showAddIncomeForm ? (
              <View style={styles.inlineEditorCard}>
                <Text style={styles.inlineEditorTitle}>Add household income source</Text>
                <Text style={styles.fieldLabelSmall}>Source name</Text>
                <TextInput
                  accessibilityLabel="Additional income source name"
                  style={styles.textInputField}
                  value={extraIncomeName}
                  onChangeText={setExtraIncomeName}
                  placeholder="Partner salary or side income"
                  placeholderTextColor="#6E7571"
                />
                <Text style={styles.fieldLabelSmall}>Take-home amount</Text>
                <TextInput
                  accessibilityLabel="Additional income amount"
                  style={styles.textInputField}
                  keyboardType="decimal-pad"
                  value={extraIncomeAmount}
                  onChangeText={setExtraIncomeAmount}
                  placeholder="1500.00"
                  placeholderTextColor="#6E7571"
                />
                <Text style={styles.fieldLabelSmall}>Frequency</Text>
                <View style={styles.choiceGrid2}>
                  {PAY_FREQUENCY_OPTIONS.slice(0, 2).map(opt => (
                    <ChoiceButton
                      key={opt.value}
                      label={opt.label}
                      compact
                      flex
                      selected={extraIncomeFreq === opt.value}
                      onPress={() => setExtraIncomeFreq(opt.value)}
                    />
                  ))}
                </View>
                <View style={[styles.choiceGrid2, { marginTop: 6 }]}>
                  {PAY_FREQUENCY_OPTIONS.slice(2, 4).map(opt => (
                    <ChoiceButton
                      key={opt.value}
                      label={opt.label}
                      compact
                      flex
                      selected={extraIncomeFreq === opt.value}
                      onPress={() => setExtraIncomeFreq(opt.value)}
                    />
                  ))}
                </View>
                <View style={[styles.choiceGrid2, { marginTop: 12 }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel adding income"
                    style={styles.subtleActionBtn}
                    onPress={() => setShowAddIncomeForm(false)}
                  >
                    <Text style={styles.subtleActionBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save income source"
                    style={styles.saveInlineBtn}
                    onPress={handleAddExtraIncome}
                  >
                    <Text style={styles.saveInlineBtnText}>Add income</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add another income source"
                style={styles.smallAddButton}
                onPress={() => {
                  clearErrors();
                  setShowAddIncomeForm(true);
                }}
              >
                <AppIcon name="add" size={18} color="#81D8CF" />
                <Text style={styles.smallAddText}>Add another income source</Text>
              </Pressable>
            )}

            {onboardingData.additionalIncomes.length > 0 ? (
              <View style={styles.summaryRowBox}>
                <Text style={styles.summaryRowLabel}>Total monthly household income</Text>
                <Text style={styles.summaryRowValue}>
                  {formatCurrency(totalMonthlyIncome, currencySymbol)}
                </Text>
              </View>
            ) : null}

            <View style={styles.calloutTeal}>
              <Text style={styles.calloutTealText}>
                Income helps estimate what you might be able to put toward debt. You remain in
                control of your payment amounts.
              </Text>
            </View>

            {!!localError ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {localError}
              </Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleContinueIncome}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 07: ONBOARDING SETUP 2 OF 5 â€” CHOOSE PREMIUM (onboard_02.png)
  // ============================================================================
  if (stage === 'onboard_2') {
    const selectPlan = (plan: PremiumPlanChoice) => {
      clearErrors();
      onUpdateOnboardingData({ ...onboardingData, selectedPlan: plan });
    };

    const handleContinuePremium = () => {
      void persistAndMove({ selectedPlan: onboardingData.selectedPlan }, 'onboard_3');
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={2}
          total={5}
          onBack={() => {
            clearErrors();
            onChangeStage('onboard_1');
          }}
        />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.introBox, styles.introCompact]}>
            <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">
              Choose how youâ€™d like to track
            </Text>
            <Text style={styles.introSubtitle}>
              Start with manual tracking or add optional bank account syncing.
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: onboardingData.selectedPlan === 'premium' }}
            accessibilityLabel="DebtFree Premium"
            style={[
              styles.planCard,
              onboardingData.selectedPlan === 'premium' && styles.planCardSelected,
            ]}
            onPress={() => selectPlan('premium')}
          >
            <View style={styles.planHead}>
              <Text style={styles.planTitle}>DebtFree Premium</Text>
              <View style={styles.planChip}>
                <Text style={styles.planChipText}>
                  {onboardingData.selectedPlan === 'premium' ? 'SELECTED' : 'MANUAL'}
                </Text>
              </View>
            </View>
            <Text style={styles.planDescription}>
              Stay in control with simple manual updates.
            </Text>
            <View style={styles.planBulletRow}>
              <AppIcon name="check" size={13} color="#7DD3C9" style={styles.planBulletIcon} />
              <Text style={styles.planBulletText}>Track debts and payments</Text>
            </View>
            <View style={styles.planBulletRow}>
              <AppIcon name="check" size={13} color="#7DD3C9" style={styles.planBulletIcon} />
              <Text style={styles.planBulletText}>Snowball & Avalanche strategies</Text>
            </View>
            <View style={styles.planBulletRow}>
              <AppIcon name="check" size={13} color="#7DD3C9" style={styles.planBulletIcon} />
              <Text style={styles.planBulletText}>Budget, progress and reminders</Text>
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: onboardingData.selectedPlan === 'premium_bank_sync' }}
            accessibilityLabel="Premium plus Bank Sync"
            style={[
              styles.planCard,
              onboardingData.selectedPlan === 'premium_bank_sync' && styles.planCardSelected,
            ]}
            onPress={() => selectPlan('premium_bank_sync')}
          >
            <View style={styles.planHead}>
              <Text style={styles.planTitle}>Premium + Bank Sync</Text>
              <View style={styles.planChip}>
                <Text style={styles.planChipText}>
                  {onboardingData.selectedPlan === 'premium_bank_sync' ? 'SELECTED' : 'OPTIONAL'}
                </Text>
              </View>
            </View>
            <Text style={styles.planDescription}>
              Everything in Premium, plus account connections.
            </Text>
            <View style={styles.planBulletRow}>
              <AppIcon name="check" size={13} color="#7DD3C9" style={styles.planBulletIcon} />
              <Text style={styles.planBulletText}>Automatic balance updates</Text>
            </View>
            <View style={styles.planBulletRow}>
              <AppIcon name="check" size={13} color="#7DD3C9" style={styles.planBulletIcon} />
              <Text style={styles.planBulletText}>Sync supported bank accounts</Text>
            </View>
            <View style={styles.planBulletRow}>
              <AppIcon name="check" size={13} color="#7DD3C9" style={styles.planBulletIcon} />
              <Text style={styles.planBulletText}>Review imported activity</Text>
            </View>
          </Pressable>

          <Text style={[styles.helpText, styles.textCenter]}>
            Pricing will be shown before purchase. Bank connection requires your permission.
          </Text>

          {onboardingData.selectedPlan === 'premium_bank_sync' ? (
            <View style={styles.calloutOrange}>
              <Text style={styles.calloutOrangeTitle}>Sandbox preview note</Text>
              <Text style={styles.calloutOrangeText}>
                Live store billing and bank-sync aggregation are not enabled in this test build. No
                charge or bank connection will occur now â€” your preference is saved and you can
                continue setting up your debts manually.
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue with Premium"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleContinuePremium}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue with Premium</Text>
            )}
          </Pressable>
          <Text style={styles.footerNoteText}>
            You can choose syncing later. No account is connected now.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 08: ONBOARDING SETUP 3 OF 5 â€” ADD YOUR DEBTS (onboard_03.png)
  // ============================================================================
  if (stage === 'onboard_3') {
    const mortgageDebt = onboardingData.debts.find(d => d.category === 'Mortgage');
    const autoLoanDebt = onboardingData.debts.find(d => d.category === 'Auto loan');
    const otherDebts = onboardingData.debts.filter(
      d => d.category !== 'Mortgage' && d.category !== 'Auto loan',
    );

    const handleHomeStatus = (status: HomeOwnershipStatus) => {
      clearErrors();
      onUpdateOnboardingData({ ...onboardingData, homeStatus: status });
      if (status === 'Own' && !mortgageDebt) {
        openNewDebtEditor('Mortgage');
      }
    };

    const handleVehicleStatus = (status: VehicleOwnershipStatus) => {
      clearErrors();
      onUpdateOnboardingData({ ...onboardingData, vehicleStatus: status });
      if (status === 'Finance' && !autoLoanDebt) {
        openNewDebtEditor('Auto loan');
      }
    };

    const handleContinueDebts = () => {
      const err = validateDebtsStep(
        onboardingData.homeStatus,
        onboardingData.vehicleStatus,
        onboardingData.debts,
      );
      if (err) {
        setLocalError(err);
        return;
      }
      void persistAndMove(
        {
          homeStatus: onboardingData.homeStatus,
          vehicleStatus: onboardingData.vehicleStatus,
          debts: onboardingData.debts,
        },
        'onboard_4',
      );
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={3}
          total={5}
          onBack={() => {
            clearErrors();
            onChangeStage('onboard_2');
          }}
        />
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
            <View style={[styles.introBox, styles.introCompact]}>
              <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">
                Letâ€™s add your debts
              </Text>
              <Text style={styles.introSubtitle}>
                Tell us what you own or pay for. Weâ€™ll only add a debt when a balance is owed.
              </Text>
            </View>

            <Text style={styles.splitLabel}>Your home</Text>
            <View style={styles.splitGrid3}>
              {(['Own', 'Rent', 'Other'] as HomeOwnershipStatus[]).map(status => (
                <ChoiceButton
                  key={status}
                  label={status}
                  compact
                  flex
                  selected={onboardingData.homeStatus === status}
                  onPress={() => handleHomeStatus(status)}
                />
              ))}
            </View>

            <Text style={styles.splitLabel}>Your vehicle</Text>
            <View style={styles.splitGrid4}>
              {(['Finance', 'Lease', 'Own', 'None'] as VehicleOwnershipStatus[]).map(status => (
                <ChoiceButton
                  key={status}
                  label={status}
                  compact
                  flex
                  selected={onboardingData.vehicleStatus === status}
                  onPress={() => handleVehicleStatus(status)}
                />
              ))}
            </View>

            <Text style={styles.sectionTitle}>Accounts to add</Text>

            {/* Mortgage Row */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mortgage â€” Home loan details"
              style={[
                styles.twoRowCard,
                (onboardingData.homeStatus === 'Own' || Boolean(mortgageDebt)) &&
                  styles.twoRowCardSelected,
              ]}
              onPress={() => openNewDebtEditor('Mortgage')}
            >
              <View style={styles.twoRowLeft}>
                <View style={styles.iconCircle}>
                  <AppIcon name="homeLoan" size={18} color="#91DED7" />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Mortgage</Text>
                  <Text style={styles.twoRowSub}>
                    {mortgageDebt
                      ? `${mortgageDebt.name} Â· ${formatCurrency(mortgageDebt.balance, currencySymbol)} Â· ${mortgageDebt.apr}% APR`
                      : 'Home loan details'}
                  </Text>
                </View>
              </View>
              <View
                style={[
                  styles.selectCircle,
                  (onboardingData.homeStatus === 'Own' || Boolean(mortgageDebt)) &&
                    styles.selectCircleSelected,
                ]}
              >
                <AppIcon
                  name={Boolean(mortgageDebt) || onboardingData.homeStatus === 'Own' ? 'check' : 'plus'}
                  size={11}
                  color="#FFFFFF"
                />
              </View>
            </Pressable>

            {/* Auto Loan Row */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Auto loan â€” Balance, APR and payment"
              style={[
                styles.twoRowCard,
                (onboardingData.vehicleStatus === 'Finance' || Boolean(autoLoanDebt)) &&
                  styles.twoRowCardSelected,
              ]}
              onPress={() => openNewDebtEditor('Auto loan')}
            >
              <View style={styles.twoRowLeft}>
                <View style={styles.iconCircle}>
                  <AppIcon name="auto" size={18} color="#91DED7" />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Auto loan</Text>
                  <Text style={styles.twoRowSub}>
                    {autoLoanDebt
                      ? `${autoLoanDebt.name} Â· ${formatCurrency(autoLoanDebt.balance, currencySymbol)} Â· ${autoLoanDebt.apr}% APR`
                      : 'Balance, APR & payment'}
                  </Text>
                </View>
              </View>
              <View
                style={[
                  styles.selectCircle,
                  (onboardingData.vehicleStatus === 'Finance' || Boolean(autoLoanDebt)) &&
                    styles.selectCircleSelected,
                ]}
              >
                <AppIcon
                  name={Boolean(autoLoanDebt) || onboardingData.vehicleStatus === 'Finance' ? 'check' : 'plus'}
                  size={11}
                  color="#FFFFFF"
                />
              </View>
            </Pressable>

            {/* Credit cards & other loans Row */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Credit cards and other loans â€” Add each account"
              style={[
                styles.twoRowCard,
                otherDebts.length > 0 && styles.twoRowCardSelected,
              ]}
              onPress={() => openNewDebtEditor('Credit card')}
            >
              <View style={styles.twoRowLeft}>
                <View style={styles.iconCircle}>
                  <AppIcon name="creditCard" size={18} color="#91DED7" />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Credit cards & other loans</Text>
                  <Text style={styles.twoRowSub}>
                    {otherDebts.length > 0
                      ? `${otherDebts.length} account${otherDebts.length === 1 ? '' : 's'} added Â· Tap to add another`
                      : 'Add each account'}
                  </Text>
                </View>
              </View>
              <AppIcon name="add" size={20} color="#8EE2D5" />
            </Pressable>

            {/* Inline Debt Form */}
            {showDebtForm ? (
              <View style={styles.inlineEditorCard}>
                <Text style={styles.inlineEditorTitle}>
                  {editingDebtId ? 'Edit debt account' : `Add ${debtCategory}`}
                </Text>

                <Text style={styles.fieldLabelSmall}>Account category</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.categoryPillsRow}
                >
                  {DEBT_CATEGORIES.map(cat => (
                    <ChoiceButton
                      key={cat}
                      label={cat}
                      compact
                      pill
                      selected={debtCategory === cat}
                      onPress={() => setDebtCategory(cat)}
                    />
                  ))}
                </ScrollView>

                <Text style={styles.fieldLabelSmall}>Debt name</Text>
                <TextInput
                  accessibilityLabel="Debt name"
                  style={styles.textInputField}
                  value={debtName}
                  onChangeText={setDebtName}
                  placeholder="e.g., Chase Freedom, Auto Loan, Mortgage"
                  placeholderTextColor="#6E7571"
                />

                <View style={styles.choiceGrid2}>
                  <View style={styles.flex1}>
                    <Text style={styles.fieldLabelSmall}>Current balance ({currencySymbol})</Text>
                    <TextInput
                      accessibilityLabel="Current balance"
                      style={styles.textInputField}
                      keyboardType="decimal-pad"
                      value={debtBalance}
                      onChangeText={setDebtBalance}
                      placeholder="4200.00"
                      placeholderTextColor="#6E7571"
                    />
                  </View>
                  <View style={styles.flex1}>
                    <Text style={styles.fieldLabelSmall}>APR (%)</Text>
                    <TextInput
                      accessibilityLabel="APR percentage"
                      style={styles.textInputField}
                      keyboardType="decimal-pad"
                      value={debtApr}
                      onChangeText={setDebtApr}
                      placeholder="19.99"
                      placeholderTextColor="#6E7571"
                    />
                  </View>
                </View>

                <View style={styles.choiceGrid2}>
                  <View style={styles.flex1}>
                    <Text style={styles.fieldLabelSmall}>Minimum payment ({currencySymbol}/mo)</Text>
                    <TextInput
                      accessibilityLabel="Minimum monthly payment"
                      style={styles.textInputField}
                      keyboardType="decimal-pad"
                      value={debtMinimum}
                      onChangeText={setDebtMinimum}
                      placeholder="125.00"
                      placeholderTextColor="#6E7571"
                    />
                  </View>
                  <View style={styles.flex1}>
                    <Text style={styles.fieldLabelSmall}>Due day (1â€“31, optional)</Text>
                    <TextInput
                      accessibilityLabel="Due day of month"
                      style={styles.textInputField}
                      keyboardType="number-pad"
                      value={debtDueDay}
                      onChangeText={setDebtDueDay}
                      placeholder="15"
                      placeholderTextColor="#6E7571"
                    />
                  </View>
                </View>

                {debtCategory === 'Credit card' ? (
                  <>
                    <Text style={styles.fieldLabelSmall}>Credit limit ({currencySymbol}, optional)</Text>
                    <TextInput
                      accessibilityLabel="Credit limit"
                      style={styles.textInputField}
                      keyboardType="decimal-pad"
                      value={debtCreditLimit}
                      onChangeText={setDebtCreditLimit}
                      placeholder="10000.00"
                      placeholderTextColor="#6E7571"
                    />
                  </>
                ) : (
                  <>
                    <Text style={styles.fieldLabelSmall}>
                      Original loan balance ({currencySymbol}, optional)
                    </Text>
                    <TextInput
                      accessibilityLabel="Original loan balance"
                      style={styles.textInputField}
                      keyboardType="decimal-pad"
                      value={debtOriginalBalance}
                      onChangeText={setDebtOriginalBalance}
                      placeholder="25000.00"
                      placeholderTextColor="#6E7571"
                    />
                  </>
                )}

                <View style={[styles.choiceGrid2, { marginTop: 14 }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel debt form"
                    style={styles.subtleActionBtn}
                    onPress={() => {
                      clearErrors();
                      setShowDebtForm(false);
                      setEditingDebtId(null);
                    }}
                  >
                    <Text style={styles.subtleActionBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save debt account"
                    disabled={saving}
                    style={[styles.saveInlineBtn, saving && styles.disabledButton]}
                    onPress={() => void handleSaveDebt()}
                  >
                    {saving ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.saveInlineBtnText}>Save debt</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* Added Debts List */}
            {onboardingData.debts.length > 0 ? (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.sectionTitle}>
                  Added accounts ({onboardingData.debts.length})
                </Text>
                {onboardingData.debts.map(item => (
                  <View key={item.id} style={styles.addedItemCard}>
                    <View style={styles.flex1}>
                      <Text style={styles.addedItemTitle}>
                        {`${item.name} Â· ${item.category}`}
                      </Text>
                      <Text style={styles.addedItemSub}>
                        {`${formatCurrency(item.balance, currencySymbol)} balance Â· ${item.apr}% APR Â· ${formatCurrency(item.minimumPayment, currencySymbol)}/mo min${
                          item.dueDay ? ` Â· Due day ${item.dueDay}` : ''
                        }`}
                      </Text>
                    </View>
                    <View style={styles.addedItemActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${item.name}`}
                        onPress={() => openEditDebtEditor(item)}
                      >
                        <Text style={styles.editActionText}>Edit</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.name}`}
                        onPress={() => void handleDeleteDebt(item.id)}
                      >
                        <Text style={styles.removeActionText}>Remove</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            <Text style={styles.helpText}>
              Rent and vehicles owned outright are not counted as debt.
            </Text>

            {!!localError ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {localError}
              </Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleContinueDebts}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 09: ONBOARDING SETUP 4 OF 5 â€” PAYOFF STRATEGY (onboard_04.png)
  // ============================================================================
  if (stage === 'onboard_4') {
    const selectStrategy = (strategy: PayoffStrategy) => {
      clearErrors();
      onUpdateOnboardingData({ ...onboardingData, strategy });
    };

    const handleContinueStrategy = () => {
      const check = validateExtraPaymentInput(extraPaymentInput);
      if (!check.valid) {
        setLocalError(check.error);
        return;
      }
      void persistAndMove(
        {
          strategy: onboardingData.strategy,
          extraMonthlyPayment: check.extraMonthlyPayment,
        },
        'onboard_5',
      );
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={4}
          total={5}
          onBack={() => {
            clearErrors();
            onChangeStage('onboard_3');
          }}
        />
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
            <View style={[styles.introBox, styles.introCompact]}>
              <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">
                Choose your payoff strategy
              </Text>
              <Text style={styles.introSubtitle}>
                Pick the approach that fits you. You can change it later.
              </Text>
            </View>

            {/* Debt Snowball */}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: onboardingData.strategy === 'snowball' }}
              accessibilityLabel="Debt Snowball â€” Pay off the smallest balance first"
              style={[
                styles.twoRowCard,
                { padding: 14 },
                onboardingData.strategy === 'snowball' && styles.twoRowCardSelected,
              ]}
              onPress={() => selectStrategy('snowball')}
            >
              <View style={styles.twoRowLeft}>
                <View style={styles.iconCircle}>
                  <AppIcon name="snowball" size={18} color="#91DED7" />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Debt Snowball</Text>
                  <Text style={styles.twoRowSub}>Pay off the smallest balance first</Text>
                </View>
              </View>
              <View
                style={[
                  styles.selectCircle,
                  onboardingData.strategy === 'snowball' && styles.selectCircleSelected,
                ]}
              >
                {onboardingData.strategy === 'snowball' ? (
                  <AppIcon name="check" size={11} color="#FFFFFF" />
                ) : null}
              </View>
            </Pressable>

            {/* Debt Avalanche */}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: onboardingData.strategy === 'avalanche' }}
              accessibilityLabel="Debt Avalanche â€” Target the highest interest rate"
              style={[
                styles.twoRowCard,
                { padding: 14 },
                onboardingData.strategy === 'avalanche' && styles.twoRowCardSelected,
              ]}
              onPress={() => selectStrategy('avalanche')}
            >
              <View style={styles.twoRowLeft}>
                <View style={styles.iconCircle}>
                  <AppIcon name="avalanche" size={18} color="#91DED7" />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.twoRowTitle}>Debt Avalanche</Text>
                  <Text style={styles.twoRowSub}>Target the highest interest rate</Text>
                </View>
              </View>
              <View
                style={[
                  styles.selectCircle,
                  onboardingData.strategy === 'avalanche' && styles.selectCircleSelected,
                ]}
              >
                {onboardingData.strategy === 'avalanche' ? (
                  <AppIcon name="check" size={11} color="#FFFFFF" />
                ) : null}
              </View>
            </Pressable>

            <Text style={[styles.fieldLabel, { marginTop: 22 }]}>
              Estimated extra payment per month
            </Text>
            <View style={styles.bigFieldBox}>
              <Text style={styles.bigFieldPrefix}>{currencySymbol}</Text>
              <TextInput
                accessibilityLabel="Estimated extra payment per month"
                style={styles.bigFieldInput}
                keyboardType="decimal-pad"
                value={extraPaymentInput}
                onChangeText={text => {
                  clearErrors();
                  setExtraPaymentInput(text);
                }}
                placeholder="150.00"
                placeholderTextColor="#6E7571"
              />
              <Text style={styles.fieldMutedUnit}>/ month</Text>
            </View>
            <Text style={styles.helpText}>
              Enter $0 if you donâ€™t plan to make extra payments.
            </Text>

            {payoffPlan && payoffPlan.payoffOrder.length > 0 ? (
              <View style={styles.strategyPreviewCard}>
                <Text style={styles.strategyPreviewHeading}>
                  {onboardingData.strategy === 'snowball'
                    ? 'Snowball plan preview'
                    : 'Avalanche plan preview'}
                </Text>
                <Text style={styles.strategyPreviewLine}>
                  {`First target: ${payoffPlan.firstTarget?.name ?? 'None'} (${formatCurrency(
                    payoffPlan.firstTarget?.firstMonthPayment ?? 0,
                    currencySymbol,
                  )}/mo)`}
                </Text>
                <Text style={styles.strategyPreviewLine}>
                  {`Total monthly plan: ${formatCurrency(
                    payoffPlan.monthlyTotalPayment,
                    currencySymbol,
                  )} Â· Debt-free: ${payoffPlan.debtFreeDateLabel}${
                    payoffPlan.monthsToPayoff !== null
                      ? ` (${payoffPlan.monthsToPayoff} mo)`
                      : ''
                  }`}
                </Text>
              </View>
            ) : null}

            <View style={[styles.calloutTeal, { marginTop: 18 }]}>
              <Text style={styles.calloutTealText}>
                Weâ€™ll use your debts and extra payment estimate to prepare a payoff plan. This
                wonâ€™t schedule or send payments.
              </Text>
            </View>

            {!!localError ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {localError}
              </Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={handleContinueStrategy}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Continue</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 10: ONBOARDING SETUP 5 OF 5 â€” NOTIFICATIONS (onboard_05.png)
  // ============================================================================
  if (stage === 'onboard_5') {
    const prefs = onboardingData.notifications;

    const toggleNotificationPref = (
      key: 'upcomingReminders' | 'overdueAlerts' | 'milestonesAndProgress',
    ) => {
      clearErrors();
      onUpdateOnboardingData({
        ...onboardingData,
        notifications: {
          ...prefs,
          [key]: !prefs[key],
        },
      });
    };

    const completeOnboarding = async (requestOsPermission: boolean) => {
      if (savingRef.current) return;
      clearErrors();
      let osStatus = prefs.osPermissionStatus;
      if (requestOsPermission) {
        osStatus = await requestNativeNotificationPermission();
      }
      const now = new Date().toISOString();
      await persistAndMove(
        {
          onboardingCompleted: true,
          completedAt: now,
          notifications: {
            ...prefs,
            permissionRequested: requestOsPermission,
            osPermissionStatus: osStatus,
          },
        },
        'home',
      );
    };

    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <ProgressHeader
          label="Setup"
          step={5}
          total={5}
          onBack={() => {
            clearErrors();
            onChangeStage('onboard_4');
          }}
        />
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <View style={[styles.introBox, styles.introCompact]}>
            <Text style={[styles.introTitle, styles.introTitleCompact]} accessibilityRole="header">
              Stay on track
            </Text>
            <Text style={styles.introSubtitle}>
              Choose the alerts that would help you most.
            </Text>
          </View>

          <View style={styles.notifyArtWrap}>
            <View style={styles.bellBox}>
              <AppIcon name="bell" size={34} color="#79D9CD" />
            </View>
          </View>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: prefs.upcomingReminders }}
            accessibilityLabel="Upcoming payment reminders"
            style={styles.toggleRow}
            onPress={() => toggleNotificationPref('upcomingReminders')}
          >
            <View style={styles.flex1}>
              <Text style={styles.toggleTitle}>Upcoming payment reminders</Text>
              <Text style={styles.toggleSub}>Get a heads-up before bills are due</Text>
            </View>
            <View style={[styles.toggleTrack, prefs.upcomingReminders && styles.toggleTrackOn]}>
              <View style={[styles.toggleThumb, prefs.upcomingReminders && styles.toggleThumbOn]} />
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: prefs.overdueAlerts }}
            accessibilityLabel="Past-due alerts"
            style={styles.toggleRow}
            onPress={() => toggleNotificationPref('overdueAlerts')}
          >
            <View style={styles.flex1}>
              <Text style={styles.toggleTitle}>Past-due alerts</Text>
              <Text style={styles.toggleSub}>Know when a bill needs attention</Text>
            </View>
            <View style={[styles.toggleTrack, prefs.overdueAlerts && styles.toggleTrackOn]}>
              <View style={[styles.toggleThumb, prefs.overdueAlerts && styles.toggleThumbOn]} />
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: prefs.milestonesAndProgress }}
            accessibilityLabel="Milestones and progress"
            style={styles.toggleRow}
            onPress={() => toggleNotificationPref('milestonesAndProgress')}
          >
            <View style={styles.flex1}>
              <Text style={styles.toggleTitle}>Milestones & progress</Text>
              <Text style={styles.toggleSub}>Celebrate payoff achievements</Text>
            </View>
            <View style={[styles.toggleTrack, prefs.milestonesAndProgress && styles.toggleTrackOn]}>
              <View
                style={[styles.toggleThumb, prefs.milestonesAndProgress && styles.toggleThumbOn]}
              />
            </View>
          </Pressable>

          <View style={[styles.calloutTeal, { marginTop: 24 }]}>
            <Text style={styles.calloutTealText}>
              Weâ€™ll ask your device for notification permission only after you choose to enable
              alerts.
            </Text>
          </View>

          {!!localError ? (
            <Text style={styles.errorText} accessibilityRole="alert">
              {localError}
            </Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enable notifications"
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabledButton]}
            onPress={() => void completeOnboarding(true)}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Enable notifications</Text>
            )}
          </Pressable>

          <View style={styles.footerInlineRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Not now"
              disabled={saving}
              onPress={() => void completeOnboarding(false)}
            >
              <Text style={styles.linkText}>Not now</Text>
            </Pressable>
            <Text style={styles.footerNoteText}>  Â·  You can change this in Settings.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // SCREEN 11: HOME DASHBOARD (stage === 'home')
  // ============================================================================
  const plan =
    payoffPlan ??
    calculatePayoffPlan(
      onboardingData.debts,
      onboardingData.strategy,
      onboardingData.extraMonthlyPayment,
    );

  const handleToggleHomeStrategy = async (nextStrategy: PayoffStrategy) => {
    if (savingRef.current || onboardingData.strategy === nextStrategy) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const updated = await saveUserOnboardingData({
        ...onboardingData,
        strategy: nextStrategy,
      });
      onUpdateOnboardingData(updated);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to update your strategy.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSaveExtra = async (amount: number) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setLocalError('');
    try {
      const updated = await saveUserOnboardingData({ ...onboardingData, extraMonthlyPayment: amount });
      onUpdateOnboardingData(updated);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to update extra payment.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const editSetup = () => { clearErrors(); onChangeStage('onboard_1'); };
  const debtEditor = showDebtForm ? (
          <View style={styles.inlineEditorCard}>
            <Text style={styles.inlineEditorTitle}>
              {editingDebtId ? 'Edit debt account' : `Add ${debtCategory}`}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryPillsRow}
            >
              {DEBT_CATEGORIES.map(cat => (
                <ChoiceButton
                  key={cat}
                  label={cat}
                  compact
                  pill
                  selected={debtCategory === cat}
                  onPress={() => setDebtCategory(cat)}
                />
              ))}
            </ScrollView>
            <Text style={styles.fieldLabelSmall}>Debt name</Text>
            <TextInput
              accessibilityLabel="Debt name"
              style={styles.textInputField}
              value={debtName}
              onChangeText={setDebtName}
              placeholder="e.g., Chase Sapphire"
              placeholderTextColor="#6E7571"
            />
            <View style={styles.choiceGrid2}>
              <View style={styles.flex1}>
                <Text style={styles.fieldLabelSmall}>Current balance ({currencySymbol})</Text>
                <TextInput
                  accessibilityLabel="Current balance"
                  style={styles.textInputField}
                  keyboardType="decimal-pad"
                  value={debtBalance}
                  onChangeText={setDebtBalance}
                  placeholder="3500.00"
                  placeholderTextColor="#6E7571"
                />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.fieldLabelSmall}>APR (%)</Text>
                <TextInput
                  accessibilityLabel="APR percentage"
                  style={styles.textInputField}
                  keyboardType="decimal-pad"
                  value={debtApr}
                  onChangeText={setDebtApr}
                  placeholder="21.99"
                  placeholderTextColor="#6E7571"
                />
              </View>
            </View>
            <View style={styles.choiceGrid2}>
              <View style={styles.flex1}>
                <Text style={styles.fieldLabelSmall}>Minimum payment ({currencySymbol}/mo)</Text>
                <TextInput
                  accessibilityLabel="Minimum monthly payment"
                  style={styles.textInputField}
                  keyboardType="decimal-pad"
                  value={debtMinimum}
                  onChangeText={setDebtMinimum}
                  placeholder="95.00"
                  placeholderTextColor="#6E7571"
                />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.fieldLabelSmall}>Due day (1â€“31)</Text>
                <TextInput
                  accessibilityLabel="Due day"
                  style={styles.textInputField}
                  keyboardType="number-pad"
                  value={debtDueDay}
                  onChangeText={setDebtDueDay}
                  placeholder="15"
                  placeholderTextColor="#6E7571"
                />
              </View>
            </View>
            <View style={styles.choiceGrid2}>
              <View style={styles.flex1}><Text style={styles.fieldLabelSmall}>Original balance (optional)</Text><TextInput accessibilityLabel="Original balance" style={styles.textInputField} keyboardType="decimal-pad" value={debtOriginalBalance} onChangeText={setDebtOriginalBalance} placeholder="Optional" placeholderTextColor="#6E7571" /></View>
              <View style={styles.flex1}><Text style={styles.fieldLabelSmall}>Credit limit (optional)</Text><TextInput accessibilityLabel="Credit limit" style={styles.textInputField} keyboardType="decimal-pad" value={debtCreditLimit} onChangeText={setDebtCreditLimit} placeholder="Optional" placeholderTextColor="#6E7571" /></View>
            </View>            {!!localError ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {localError}
              </Text>
            ) : null}
            <View style={[styles.choiceGrid2, { marginTop: 12 }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel debt form"
                style={styles.subtleActionBtn}
                onPress={() => {
                  clearErrors();
                  setShowDebtForm(false);
                  setEditingDebtId(null);
                }}
              >
                <Text style={styles.subtleActionBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save debt account"
                disabled={saving}
                style={[styles.saveInlineBtn, saving && styles.disabledButton]}
                onPress={() => void handleSaveDebt()}
              >
                <Text style={styles.saveInlineBtnText}>Save debt</Text>
              </Pressable>
            </View>
          </View>
        ) : null;

  return (
    <FiveTabShell key={session?.user.id ?? onboardingData.userId}
      debt={<DebtScreen debts={onboardingData.debts} plan={plan} currencySymbol={currencySymbol} editor={debtEditor} error={localError} onAdd={() => openNewDebtEditor('Credit card')} onEdit={openEditDebtEditor} onRemove={item => { void handleDeleteDebt(item.id); }} onSettings={editSetup} />}
      transactions={<TransactionsScreen debts={onboardingData.debts} onSettings={editSetup} />}
      budget={section => <BudgetScreen key={section} initialSection={section} data={onboardingData} plan={plan} currencySymbol={currencySymbol} onEditIncome={editSetup} onSettings={editSetup} onStrategy={value => { void handleToggleHomeStrategy(value); }} onExtra={value => { void handleSaveExtra(value); }} error={localError} />}
      progress={<ProgressScreen debts={onboardingData.debts} currencySymbol={currencySymbol} onSettings={editSetup} />}
      home={navigate => (
    <View style={styles.root}>
      <View style={styles.homeHeader}>
        <View style={styles.logoBrand} accessible accessibilityRole="header" accessibilityLabel="DebtFree Home">
          <View style={styles.brandMark}>
            <AppIcon name="brandRise" size={16} color="#FFFFFF" />
          </View>
          <Text style={styles.logoText}>
            Debt<Text style={styles.logoTextAccent}>Free</Text>
          </Text>
        </View>
        <View style={styles.homeHeaderActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit setup"
            style={styles.headerActionPill}
            onPress={() => {
              clearErrors();
              onChangeStage('onboard_1');
            }}
          >
            <AppIcon name="settings" size={12} color="#81DFD2" />
            <Text style={styles.headerActionPillText}>Edit Setup</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            disabled={authBusy}
            style={[styles.headerSignOutPill, authBusy && styles.disabledButton]}
            onPress={() => void onSignOut()}
          >
            <Text style={styles.headerSignOutPillText}>Sign Out</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
        <Text style={ui.title}>{`Hi, ${session?.user.user_metadata?.full_name?.split(' ')[0] || session?.user.email?.split('@')[0] || 'there'}`}</Text>
        <Text style={ui.text}>Your debt-free journey</Text>
        <Card>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={ui.heading}>Your debt-free date</Text>
            <View style={ui.badge}>
              <Text style={ui.badgeText}>ESTIMATE</Text>
            </View>
          </View>
          <Text style={ui.small}>All active debts · projected from your plan</Text>
          <View style={[ui.row, { justifyContent: 'space-between', alignItems: 'stretch' }]}>
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <Text style={ui.title}>{plan.debtFreeDateLabel}</Text>
            </View>
            <View style={{ width: 1, backgroundColor: '#353A37' }} />
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingLeft: 12 }}>
              <Text style={ui.heading}>{plan.monthsToPayoff ?? '—'}</Text>
              <Text style={ui.small}>months to go</Text>
            </View>
          </View>
          <Bar percent={plan.progressPercent} />
          <Text style={ui.small}>Balance snapshot · Keep building your freedom.</Text>
        </Card>
        <SnapshotCard debts={onboardingData.debts} currencySymbol={currencySymbol} />
        <Card>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={ui.heading}>Payoff strategy</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="See all payoff strategy details"
              style={[ui.row, { gap: 4 }]}
              onPress={() => navigate('budget', 'Strategy')}
            >
              <Text style={ui.buttonText}>See all</Text>
              <AppIcon name="chevronRight" size={12} color="#81DFD2" />
            </Pressable>
          </View>
          <Text style={ui.text}>
            {onboardingData.strategy === 'avalanche' ? 'Avalanche' : 'Snowball'} · All active debts
          </Text>
          <View style={ui.row}>
            {(['avalanche', 'snowball'] as const).map(strategy => (
              <Pressable
                key={strategy}
                accessibilityRole="button"
                accessibilityState={{ selected: onboardingData.strategy === strategy }}
                style={[ui.button, onboardingData.strategy === strategy && ui.selected]}
                onPress={() => void handleToggleHomeStrategy(strategy)}
              >
                <AppIcon name={strategy} size={14} color="#81DFD2" />
                <Text style={ui.buttonText}>
                  {strategy === 'avalanche' ? 'Avalanche' : 'Snowball'}
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => openNewDebtEditor('Credit card')}
              style={ui.button}
            >
              <AppIcon name="plus" size={12} color="#81DFD2" />
              <Text style={ui.buttonText}>Add debt</Text>
            </Pressable>
          </View>
          {!!localError && !showDebtForm && (
            <Text accessibilityRole="alert" style={ui.text}>
              {localError}
            </Text>
          )}
          {debtEditor}
          {plan.payoffOrder.map((item, idx) => {
            const fullDebt = onboardingData.debts.find(d => d.id === item.id);
            return (
              <View key={item.id} style={[ui.divider, ui.row]}>
                <View style={ui.badge}>
                  <Text style={ui.badgeText}>#{idx + 1}</Text>
                </View>
                <View style={ui.iconCircle}>
                  <AppIcon
                    name={
                      item.category === 'Mortgage'
                        ? 'homeLoan'
                        : item.category === 'Auto loan'
                          ? 'auto'
                          : 'creditCard'
                    }
                    color="#81DFD2"
                    size={18}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ui.heading}>{item.name}</Text>
                  <Text style={ui.small}>
                    {`${item.apr}% APR · ${formatCurrency(item.firstMonthPayment, currencySymbol)}/mo`}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <View style={ui.badge}>
                    <Text style={ui.badgeText}>{item.projectedPayoffLabel}</Text>
                  </View>
                  {fullDebt ? (
                    <View style={[ui.row, { gap: 10 }]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${item.name}`}
                        onPress={() => openEditDebtEditor(fullDebt)}
                      >
                        <Text style={ui.buttonText}>Edit</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.name}`}
                        onPress={() => void handleDeleteDebt(item.id)}
                      >
                        <Text style={[ui.buttonText, { color: '#E3A088' }]}>Remove</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>
        <Card>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={ui.heading}>Recent activity</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="See all recent activity"
              style={[ui.row, { gap: 4 }]}
              onPress={() => navigate('transactions')}
            >
              <Text style={ui.buttonText}>See all</Text>
              <AppIcon name="chevronRight" size={12} color="#81DFD2" />
            </Pressable>
          </View>
          <Text style={ui.text}>No recorded activity yet. Transaction records are not connected.</Text>
        </Card>
        <Card>
          <View style={[ui.row, { justifyContent: 'space-between' }]}>
            <Text style={ui.heading}>Upcoming bills</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="See all upcoming bills"
              style={[ui.row, { gap: 4 }]}
              onPress={() => navigate('budget', 'Upcoming')}
            >
              <Text style={ui.buttonText}>See all</Text>
              <AppIcon name="chevronRight" size={12} color="#81DFD2" />
            </Pressable>
          </View>
          <Text style={ui.text}>Verified dated bills are unavailable.</Text>
        </Card>
      </ScrollView>
    </View>
    )} />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1F201F',
  },
  flex1: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  spacer: {
    flex: 1,
    minHeight: 16,
  },
  textCenter: {
    textAlign: 'center',
  },
  // Top Bar & Segmented Progress
  topBar: {
    height: 74,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    paddingHorizontal: 24,
  },
  backButton: {
    position: 'absolute',
    left: 22,
    top: 18,
    width: 36,
    height: 36,
    justifyContent: 'center',
  },
  stepText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F9F9F6',
    letterSpacing: 0.1,
  },
  progressRow: {
    position: 'absolute',
    bottom: 2,
    left: 26,
    right: 26,
    height: 3,
    flexDirection: 'row',
    gap: 4,
  },
  progressSegment: {
    flex: 1,
    height: 3,
    borderRadius: 5,
    backgroundColor: '#414743',
  },
  progressSegmentDone: {
    backgroundColor: '#AD5637',
  },
  // Welcome Screen
  welcomeScroll: {
    flexGrow: 1,
    paddingBottom: 12,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 20,
  },
  logoBrand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandMark: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#369B97',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },
  logoText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F9F9F6',
    letterSpacing: -0.8,
  },
  logoTextAccent: {
    color: '#50C7C0',
  },
  topSignInLink: {
    color: '#58CBD0',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  heroSection: {
    height: 280,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginTop: 8,
  },
  orbitContainer: {
    width: 164,
    height: 164,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  orbitBase: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 16,
    borderColor: '#3B3E3A',
  },
  orbitArcTeal: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 16,
    borderColor: 'transparent',
    borderTopColor: '#58CCC5',
    borderRightColor: '#58CCC5',
    transform: [{ rotate: '-28deg' }],
  },
  orbitArcTerracotta: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 16,
    borderColor: 'transparent',
    borderBottomColor: '#AD5637',
    transform: [{ rotate: '-28deg' }],
  },
  orbitCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBigText: {
    fontSize: 33,
    fontWeight: '800',
    color: '#F9F9F6',
    letterSpacing: -1,
  },
  heroMiniText: {
    fontSize: 11,
    color: '#B7C6C0',
    marginTop: 2,
  },
  floatingCard: {
    position: 'absolute',
    backgroundColor: '#2A2C2B',
    borderWidth: 1,
    borderColor: '#414743',
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
    zIndex: 2,
  },
  floatingCardLeft: {
    left: 24,
    top: 46,
  },
  floatingCardRight: {
    right: 18,
    bottom: 34,
  },
  floatingCardLabel: {
    fontSize: 11,
    color: '#E8EDE9',
  },
  floatingCardValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  floatingCardValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#73D9C6',
    marginTop: 3,
  },
  welcomeCopy: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 6,
  },
  badgeSmall: {
    backgroundColor: '#303C38',
    borderRadius: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginBottom: 16,
  },
  badgeSmallText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#81DFD2',
    letterSpacing: 0.7,
  },
  welcomeTitle: {
    fontSize: 29,
    lineHeight: 34,
    fontWeight: '800',
    color: '#F9F9F6',
    textAlign: 'center',
    letterSpacing: -0.8,
    marginBottom: 12,
  },
  welcomeSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: '#ADB8AF',
    textAlign: 'center',
    maxWidth: 310,
  },
  // Step Content & Intro
  stepContent: {
    paddingHorizontal: 25,
    paddingTop: 22,
    paddingBottom: 24,
  },
  introBox: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 22,
  },
  introCompact: {
    paddingTop: 2,
    paddingBottom: 18,
  },
  introTitle: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '700',
    color: '#F9F9F6',
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 11,
  },
  introTitleCompact: {
    fontSize: 22,
  },
  introSubtitle: {
    fontSize: 14,
    lineHeight: 21,
    color: '#B5B9B5',
    textAlign: 'center',
    maxWidth: 310,
  },
  // Buttons & Footer
  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 42,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
    backgroundColor: '#1F201F',
  },
  primaryButton: {
    minHeight: 51,
    borderRadius: 9,
    backgroundColor: '#A34F34',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryButtonHot: {
    backgroundColor: '#FA6E2B',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  disabledButton: {
    opacity: 0.55,
  },
  footerInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 13,
  },
  footerNoteText: {
    fontSize: 11,
    color: '#9DA5A0',
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 11,
  },
  linkText: {
    fontSize: 12,
    color: '#58CBD0',
    fontWeight: '700',
  },
  inlineLinkWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legalNote: {
    fontSize: 11,
    color: '#747D77',
    textAlign: 'center',
    marginTop: 14,
  },
  // Provider buttons (Step 1 of 4)
  providerButton: {
    borderWidth: 1,
    borderColor: '#474D49',
    borderRadius: 9,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
    marginBottom: 9,
    backgroundColor: '#232524',
    paddingHorizontal: 14,
  },
  providerButtonConnected: {
    borderColor: '#35645B',
    backgroundColor: '#243531',
  },
  providerButtonPassive: {
    opacity: 0.85,
  },
  providerButtonText: {
    color: '#F9F9F6',
    fontSize: 13,
    fontWeight: '700',
  },
  googleLetterIcon: {
    fontSize: 17,
    fontWeight: '800',
    color: '#4285F4',
  },
  appleMarkBox: {
    width: 18,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appleMarkLeaf: {
    width: 5,
    height: 5,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 5,
    borderBottomRightRadius: 5,
    marginLeft: 2,
    marginBottom: 1,
    transform: [{ rotate: '15deg' }],
  },
  appleMarkBody: {
    width: 15,
    height: 13,
    flexDirection: 'row',
    justifyContent: 'center',
    position: 'relative',
  },
  appleMarkLobeLeft: {
    width: 9,
    height: 13,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    marginRight: -2,
  },
  appleMarkLobeRight: {
    width: 9,
    height: 13,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
  },
  appleMarkBite: {
    position: 'absolute',
    right: -2,
    top: 3,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#232524',
  },
  appleNativeButton: {
    width: '100%',
    height: 46,
    marginBottom: 9,
  },
  hlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 17,
  },
  hlineBar: {
    flex: 1,
    height: 1,
    backgroundColor: '#454947',
  },
  hlineLabel: {
    color: '#707872',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  // Choices & Grids
  choice: {
    minHeight: 43,
    width: '100%',
    borderWidth: 1,
    borderColor: '#5E635F',
    borderRadius: 9,
    backgroundColor: '#272928',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 8,
    position: 'relative',
  },
  choiceCompact: {
    minHeight: 36,
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginBottom: 0,
  },
  choiceFlex: {
    flex: 1,
    width: undefined,
    marginBottom: 0,
  },
  choicePill: {
    width: undefined,
    paddingHorizontal: 14,
    marginBottom: 0,
  },
  choicePillSelected: {
    paddingLeft: 24,
  },
  choiceSelected: {
    borderWidth: 1.5,
    borderColor: '#BA6748',
    backgroundColor: '#392B24',
  },
  choiceCheck: {
    position: 'absolute',
    left: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceCheckCompact: {
    left: 7,
  },
  choiceText: {
    color: '#F5F5F3',
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
  },
  choiceTextCompact: {
    fontSize: 11,
  },
  choiceTextSelected: {
    color: '#FFFFFF',
  },
  choiceGrid2: {
    flexDirection: 'row',
    gap: 8,
  },
  splitLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B3BBB5',
    marginTop: 6,
    marginBottom: 8,
  },
  splitGrid3: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  splitGrid4: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 14,
  },
  // Callouts
  calloutTeal: {
    padding: 12,
    backgroundColor: '#243531',
    borderWidth: 1,
    borderColor: '#35645B',
    borderRadius: 9,
    marginTop: 13,
  },
  calloutTealText: {
    color: '#B8DDD4',
    fontSize: 12,
    lineHeight: 18,
  },
  calloutOrange: {
    padding: 12,
    backgroundColor: '#332921',
    borderWidth: 1,
    borderColor: '#6F4939',
    borderRadius: 9,
    marginTop: 13,
  },
  calloutOrangeTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  calloutOrangeText: {
    color: '#E5C6B4',
    fontSize: 12,
    lineHeight: 18,
  },
  // Fields & Labels
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B1B4B0',
    marginTop: 16,
    marginBottom: 7,
  },
  fieldLabelSmall: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B1B4B0',
    marginTop: 10,
    marginBottom: 5,
  },
  countrySelector: {
    width: 112,
    minHeight: 54,
    borderWidth: 1,
    borderColor: '#555B57',
    borderRadius: 9,
    backgroundColor: '#222423',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  countryFlagText: {
    fontSize: 22,
  },
  countryDropdown: {
    marginBottom: 12,
  },
  bigFieldBox: {
    width: '100%',
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#555B57',
    borderRadius: 9,
    backgroundColor: '#222423',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  bigFieldPrefix: {
    fontSize: 23,
    fontWeight: '700',
    color: '#FBFBF9',
    marginRight: 6,
  },
  bigFieldInput: {
    flex: 1,
    fontSize: 23,
    fontWeight: '700',
    color: '#FBFBF9',
    paddingVertical: 10,
  },
  fieldMutedUnit: {
    color: '#9DA6A0',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  helpText: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 16,
    color: '#929B95',
  },
  sectionTitle: {
    fontSize: 13,
    color: '#E9EBEA',
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 10,
  },
  smallAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#62736C',
    borderRadius: 10,
    padding: 13,
  },
  smallAddText: {
    color: '#81D8CF',
    fontSize: 12,
    fontWeight: '700',
  },
  // Plan Cards (Step 2 of 5)
  planCard: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#515853',
    backgroundColor: '#262927',
    borderRadius: 12,
    marginBottom: 11,
  },
  planCardSelected: {
    backgroundColor: '#322922',
    borderColor: '#B85B39',
  },
  planHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#F9F9F6',
  },
  planChip: {
    backgroundColor: '#3A4C45',
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  planChipText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#96DBCC',
    letterSpacing: 0.4,
  },
  planDescription: {
    fontSize: 11,
    color: '#B8C0B9',
    marginBottom: 8,
    lineHeight: 16,
  },
  planBulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
  },
  planBulletIcon: {
    marginRight: 7,
  },
  planBulletText: {
    fontSize: 11,
    color: '#EBEEEB',
  },
  // Two-Row Cards (Step 3 & Step 4)
  twoRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#454C47',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 13,
    backgroundColor: '#282A28',
    marginBottom: 9,
    minHeight: 56,
  },
  twoRowCardSelected: {
    borderColor: '#BA684A',
    backgroundColor: '#362A26',
  },
  twoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#344743',
    alignItems: 'center',
    justifyContent: 'center',
  },
  twoRowTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F9F9F6',
  },
  twoRowSub: {
    fontSize: 11,
    color: '#ADB4AD',
    marginTop: 3,
  },
  selectCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#626B64',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectCircleSelected: {
    backgroundColor: '#AA563B',
    borderColor: '#AA563B',
  },
  // Inline Editor & Added Items
  inlineEditorCard: {
    backgroundColor: '#262927',
    borderWidth: 1,
    borderColor: '#555B57',
    borderRadius: 11,
    padding: 14,
    marginVertical: 10,
  },
  inlineEditorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F9F9F6',
    marginBottom: 6,
  },
  categoryPillsRow: {
    gap: 6,
    paddingVertical: 4,
  },
  textInputField: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#555B57',
    borderRadius: 8,
    backgroundColor: '#222423',
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#FBFBF9',
  },
  subtleActionBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#2D302E',
    borderWidth: 1,
    borderColor: '#5D6660',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtleActionBtnText: {
    color: '#E5E7E5',
    fontSize: 13,
    fontWeight: '600',
  },
  saveInlineBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: '#A34F34',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveInlineBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  addedItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#262927',
    borderWidth: 1,
    borderColor: '#414743',
    borderRadius: 9,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  addedItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F9F9F6',
  },
  addedItemSub: {
    fontSize: 11,
    color: '#AAB3AC',
    marginTop: 3,
  },
  addedItemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  editActionText: {
    color: '#58CBD0',
    fontSize: 12,
    fontWeight: '700',
  },
  removeActionText: {
    color: '#FF8A75',
    fontSize: 12,
    fontWeight: '700',
  },
  summaryRowBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#283330',
    borderRadius: 9,
    padding: 12,
    marginTop: 10,
  },
  summaryRowLabel: {
    fontSize: 12,
    color: '#B8DDD4',
    fontWeight: '600',
  },
  summaryRowValue: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  // Strategy Preview (Step 4)
  strategyPreviewCard: {
    backgroundColor: '#283330',
    borderWidth: 1,
    borderColor: '#3E6B62',
    borderRadius: 9,
    padding: 12,
    marginTop: 14,
  },
  strategyPreviewHeading: {
    fontSize: 12,
    fontWeight: '800',
    color: '#80D8CF',
    marginBottom: 4,
  },
  strategyPreviewLine: {
    fontSize: 12,
    color: '#E9EBEA',
    lineHeight: 18,
  },
  // Notifications (Step 5)
  notifyArtWrap: {
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 12,
  },
  bellBox: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: '#293B36',
    borderWidth: 1,
    borderColor: '#3E6B62',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333A35',
    gap: 12,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F9F9F6',
  },
  toggleSub: {
    fontSize: 11,
    color: '#AAB3AC',
    marginTop: 4,
    lineHeight: 16,
  },
  toggleTrack: {
    width: 39,
    height: 23,
    borderRadius: 12,
    backgroundColor: '#454A46',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleTrackOn: {
    backgroundColor: '#388B80',
  },
  toggleThumb: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: '#C9CECA',
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
    backgroundColor: '#FFFFFF',
  },
  // Error text
  errorText: {
    color: '#FF8A75',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 18,
    fontWeight: '600',
  },
  // Home Dashboard
  homeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2E3330',
  },
  homeHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: '#2A2F2C',
    borderWidth: 1,
    borderColor: '#454C47',
  },
  headerActionPillText: {
    color: '#81DFD2',
    fontSize: 11,
    fontWeight: '700',
  },
  headerSignOutPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: '#392B24',
    borderWidth: 1,
    borderColor: '#BA6748',
  },
  headerSignOutPillText: {
    color: '#FF9367',
    fontSize: 11,
    fontWeight: '700',
  },
  homeContent: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 34,
  },
  homeHeroCard: {
    backgroundColor: '#262927',
    borderWidth: 1,
    borderColor: '#414743',
    borderRadius: 14,
    padding: 16,
  },
  homeHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  overlineTeal: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7BD5CD',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  homeTotalDebtAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.6,
  },
  homeHeroSub: {
    fontSize: 11,
    color: '#AAB3AC',
    marginTop: 2,
  },
  homeProgressBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    borderColor: '#58CCC5',
    backgroundColor: '#243531',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeProgressPercent: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  homeProgressCaption: {
    fontSize: 9,
    color: '#81DFD2',
  },
  homeStatsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  homeStatCell: {
    flex: 1,
    backgroundColor: '#202321',
    borderRadius: 9,
    padding: 10,
    borderWidth: 1,
    borderColor: '#343A36',
  },
  homeStatLabel: {
    fontSize: 10,
    color: '#9DA5A0',
    fontWeight: '600',
  },
  homeStatValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#D9F7EA',
    marginTop: 2,
  },
  homeStatMicro: {
    fontSize: 10,
    color: '#89928D',
    marginTop: 2,
  },
  priorityCard: {
    backgroundColor: '#362A26',
    borderWidth: 1,
    borderColor: '#BA684A',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  priorityTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  prioritySub: {
    fontSize: 11,
    color: '#E5C6B4',
    marginTop: 3,
    marginBottom: 8,
  },
  priorityMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  priorityMetricLabel: {
    fontSize: 11,
    color: '#E5C6B4',
  },
  priorityMetricValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 10,
  },
  homeDebtCard: {
    backgroundColor: '#262927',
    borderWidth: 1,
    borderColor: '#414743',
    borderRadius: 11,
    padding: 13,
    marginBottom: 9,
  },
  homeDebtHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  priorityOrderPill: {
    backgroundColor: '#344743',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  priorityOrderPillText: {
    color: '#91DED7',
    fontSize: 11,
    fontWeight: '800',
  },
  homeDebtName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F9F9F6',
  },
  homeDebtMeta: {
    fontSize: 11,
    color: '#AAB3AC',
    marginTop: 2,
  },
  homeDebtBalance: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  homeDebtFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#333A35',
  },
  homeDebtPlanText: {
    fontSize: 11,
    color: '#81DFD2',
    fontWeight: '600',
  },
});




