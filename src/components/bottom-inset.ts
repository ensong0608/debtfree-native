import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Returns spacing that keeps a bottom anchored control above the live system inset. */
export function bottomInsetPadding(inset: number, spacing = 0) {
  return inset + spacing;
}

export function useBottomInset() {
  return useSafeAreaInsets().bottom;
}
