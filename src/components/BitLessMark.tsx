import Svg, { Path } from 'react-native-svg';
import { useNativeAppearance } from './NativeAppearance';

export function BitLessMark() {
  const { palette } = useNativeAppearance();
  return (
    <Svg width={19} height={24} viewBox="100 12 156 208" accessible={false}>
      <Path
        d="M 212 99 C 196 87, 160 87, 160 105 C 160 123, 196 123, 214 113 C 242 125, 246 164, 218 182 C 192 198, 148 192, 130 166 C 112 140, 114 82, 136 56 C 156 32, 200 34, 218 56 C 230 71, 226 89, 212 99 Z"
        fill="none"
        stroke={palette.brand}
        strokeWidth={20}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
