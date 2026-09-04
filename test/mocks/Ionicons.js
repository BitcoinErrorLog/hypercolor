const React = require('react');
const { Text } = require('react-native');

function Ionicons(props) {
  return React.createElement(Text, props, props.name);
}

module.exports = Ionicons;
module.exports.default = Ionicons;
