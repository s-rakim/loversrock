import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Linking from "expo-linking";

import LoginScreen from "./app/LoginScreen";
import PairingScreen from "./app/PairingScreen";
import DailyPromptScreen from "./app/DailyPromptScreen";

const Stack = createNativeStackNavigator();

// Deep link handling for invite codes: candleapp://invite/ABC123
// Covers both cold-start (app opened via the link) and warm-start (app already
// running, link received while foregrounded) per SPEC.md Feature 1.
const linking = {
  prefixes: [Linking.createURL("/")],
  config: {
    screens: {
      Pairing: "invite/:code",
    },
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer linking={linking}>
        <Stack.Navigator initialRouteName="Login">
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: "CandleApp" }} />
          <Stack.Screen name="Pairing" component={PairingScreen} options={{ title: "Link with your partner" }} />
          <Stack.Screen name="DailyPrompt" component={DailyPromptScreen} options={{ title: "Today" }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
