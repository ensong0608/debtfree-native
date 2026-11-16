import Svg, { Path, Rect } from 'react-native-svg';

export function BitLessMark() {
  return <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false}>
    <Rect width="24" height="24" rx="7" fill="#0051FB" />
    <Rect x="5" y="9" width="4" height="11" rx="2" fill="#ABDFFD" />
    <Rect x="10" y="12" width="4" height="8" rx="2" fill="#27EEE9" />
    <Rect x="15" y="15" width="4" height="5" rx="2" fill="#98EDC1" />
    <Path d="M15 10C15 6 16 3 19 3c0 4-1 6-4 7ZM18 11c1-2 2-3 4-3 0 2-2 3-4 3Z" fill="white" />
  </Svg>;
}
