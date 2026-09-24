import {states} from './jsons/states';
import {territories} from './jsons/territories';
import {associations} from './jsons/associations';
import {canada} from './jsons/canada';

const _ = require('lodash');

const allRegions = {...states, ...territories, ...associations, ...canada};
const uspsFullNameMap = _.mapValues(allRegions, value => {
  return value.name || null;
});

// sanitize words to only lowercase and uppercase letters
function sanitizeToLettersOnly(words) {
  if (!words) return [];

  const sanitize = function (word) {
    return word
      .trim()
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase();
  };

  return Array.isArray(words) ? words.map(sanitize) : sanitize(words);
}

// map all state variations to their USPS abbreviation
function getPatterns(json) {
  return _.reduce(
    json,
    (result, value, key) => {
      const values = [key, value['name'], value['AP'], value['other']];

      result[key] = _.flatMap(values, sanitizeToLettersOnly);
      return result;
    },
    {}
  );
}

const patterns = {
  state: getPatterns(states),
  territory: getPatterns(territories),
  associated: getPatterns(associations),
  canada: getPatterns(canada),
};

/*
    options: {
      region: [String|Array] ('all', 'state', 'territory', 'associated'),
      returnType: [String|Function] ('USPS', 'name', 'AP', function(states){}),
      omit: [String/Array] - USPS abbr. to omit
    }
 */
const defaultOptions = {
  region: 'all',
  returnType: 'USPS',
  omit: null,
};

export function normalize(state, options?) {
  const sanitizedState = sanitizeToLettersOnly(state);
  const opts = {...defaultOptions, ...options};

  const regions =
    opts.region === 'all'
      ? ['state', 'territory', 'associated', 'canada']
      : _.castArray(opts.region);
  const regionPatterns = _.map(regions, r => {
    return patterns[r];
  });
  const keys = Object.assign.apply(this, [{}].concat(regionPatterns));

  if (opts.omit) {
    _.castArray(opts.omit).forEach(key => {
      delete keys[key];
    });
  }

  const uspsKey = _.findKey(keys, p => {
    return ~p.indexOf(sanitizedState);
  });

  if (_.isFunction(opts.returnType)) {
    return opts.returnType(uspsFullNameMap)[uspsKey] || null;
  }

  // eslint-disable-next-line default-case
  switch (opts.returnType) {
    case 'USPS':
      return uspsKey || null;

    case 'name':
    case 'AP':
      return allRegions[uspsKey][opts.returnType] || null;
  }

  return null;
}
