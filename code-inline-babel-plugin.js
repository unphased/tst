import * as types from '@babel/types';

export default function(_babel) {
  const t = types;

  return {
    name: "augmenting log statements with metadata",
    visitor: {

