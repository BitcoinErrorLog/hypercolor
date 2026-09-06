const React = require('react');
const { View } = require('react-native');

function CameraView(props) {
  return React.createElement(View, props);
}

module.exports = {
  CameraView,
  Camera: {
    requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  },
};
