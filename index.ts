import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import App from './App';
import { processIncomingSms } from './src/services/backgroundTasks';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Register Headless JS task for incoming SMS on Android
AppRegistry.registerHeadlessTask('SmsHeadlessTask', () => async (taskData: any) => {
  const { body, date } = taskData;
  if (body && date) {
    await processIncomingSms(body, Number(date));
  }
});
