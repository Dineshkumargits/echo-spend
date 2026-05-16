const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Ensure that only one copy of React and React-DOM are bundled.
// This resolves the "Cannot read property 'useContext' of null" error 
// caused by duplicate React instances in library node_modules.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.resolve(__dirname, "node_modules/react"),
  "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
  "react-native": path.resolve(__dirname, "node_modules/react-native"),
  "@react-native-community/datetimepicker": path.resolve(__dirname, "node_modules/@react-native-community/datetimepicker"),
};

// Also ensure that we don't accidentally resolve to nested node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
];

module.exports = withNativeWind(config, { input: "./src/global.css" });
