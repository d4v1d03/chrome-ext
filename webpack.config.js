const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  entry: {
    popup: './src/popup.js',
    content: './src/content.js',
    background: './src/background.js',
  },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  mode: 'development',
  devtool: 'cheap-source-map',
  resolve: {
    fallback: {
      buffer: require.resolve('buffer/'),
      crypto: false,
      stream: false,
      path: false,
      fs: false,
      os: false,
      http: false,
      https: false,
      net: false,
      tls: false,
      zlib: false,
    },
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [{ from: 'static' }],
    }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
    new webpack.DefinePlugin({
      'process.browser': JSON.stringify(true),
    }),
  ],
  module: {
    rules: [
      {
        test: /\.m?js$/,
        resolve: {
          fullySpecified: false,
        },
      },
    ],
  },
};
