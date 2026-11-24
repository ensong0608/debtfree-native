import * as Sentry from '@sentry/react-native';
import { createTelemetry } from './telemetry-core';

export const captureExceptionSafely = createTelemetry(Sentry, process.env.EXPO_PUBLIC_SENTRY_DSN);
