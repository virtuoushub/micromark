exports.tokenize = tokenizeHtml
exports.resolveTo = resolveToHtml

var assert = require('assert')
var asciiAlpha = require('../character/ascii-alpha')
var asciiAlphanumeric = require('../character/ascii-alphanumeric')
var codes = require('../character/codes')
var markdownLineEnding = require('../character/markdown-line-ending')
var markdownEnding = require('../character/markdown-ending')
var markdownEndingOrSpace = require('../character/markdown-ending-or-space')
var markdownSpace = require('../character/markdown-space')
var constants = require('../constant/constants')
var fromCharCode = require('../constant/from-char-code')
var basics = require('../constant/html-block-names')
var raws = require('../constant/html-raw-names')
var types = require('../constant/types')
var lowercase = require('../util/lowercase')

var blank = {tokenize: tokenizeBlank}

function resolveToHtml(events) {
  var tailIndex = events.length - 1
  var event

  while (tailIndex) {
    event = events[tailIndex]

    if (event[0] === 'enter' && event[1].type === types.htmlFlow) {
      break
    }

    tailIndex--
  }

  event = tailIndex - 2 >= 0 ? events[tailIndex - 2] : undefined

  if (event && event[0] === 'enter' && event[1].type === types.linePrefix) {
    // Add the prefix start to the HTML token.
    events[tailIndex][1].start = event[1].start
    // Remove the line prefix.
    events.splice(tailIndex - 2, 2)
  }

  return events
}

function tokenizeHtml(effects, ok, nok) {
  var self = this
  var kind
  var startTag
  var buffer
  var index
  var attributeMarker

  return start

  function start(code) {
    if (code !== codes.lessThan) {
      return nok(code)
    }

    effects.enter(types.htmlFlow)
    effects.consume(code)
    return open
  }

  function open(code) {
    if (code === codes.exclamationMark) {
      effects.consume(code)
      return declarationStart
    }

    if (code === codes.slash) {
      effects.consume(code)
      return tagCloseStart
    }

    if (code === codes.questionMark) {
      effects.consume(code)
      kind = constants.htmlInstruction
      // While we’re in an instruction instead of a declaration, we’re on a `?`
      // right now, so we do need to search for `>`, similar to declarations.
      return continuationDeclarationInside
    }

    if (asciiAlpha(code)) {
      effects.consume(code)
      startTag = true
      buffer = fromCharCode(lowercase(code))
      return tagName
    }

    return nok(code)
  }

  function declarationStart(code) {
    if (code === codes.dash) {
      effects.consume(code)
      kind = constants.htmlComment
      return commentOpenInside
    }

    if (code === codes.leftSquareBracket) {
      effects.consume(code)
      kind = constants.htmlCdata
      index = 0
      buffer = constants.cdataOpeningString
      return cdataOpenInside
    }

    if (asciiAlpha(code)) {
      effects.consume(code)
      kind = constants.htmlDeclaration
      return continuationDeclarationInside
    }

    return nok(code)
  }

  function commentOpenInside(code) {
    if (code === codes.dash) {
      effects.consume(code)
      return continuationDeclarationInside
    }

    return nok(code)
  }

  function cdataOpenInside(code) {
    if (code === buffer.charCodeAt(index)) {
      effects.consume(code)
      index++
      return index === buffer.length ? continuation : cdataOpenInside
    }

    return nok(code)
  }

  function tagCloseStart(code) {
    if (asciiAlpha(code)) {
      effects.consume(code)
      buffer = fromCharCode(lowercase(code))
      return tagName
    }

    return nok(code)
  }

  function tagName(code) {
    var selfClosing = code === codes.slash
    var raw
    var basic

    if (
      markdownEndingOrSpace(code) ||
      code === codes.greaterThan ||
      selfClosing
    ) {
      raw = raws.indexOf(buffer) !== -1
      basic = basics.indexOf(buffer) !== -1

      if (raw && startTag && !selfClosing) {
        kind = constants.htmlRaw
        return continuation(code)
      }

      if (basic) {
        kind = constants.htmlBasic

        if (selfClosing) {
          effects.consume(code)
          return basicSelfClosing
        }

        return continuation(code)
      }

      // Do not support complete HTML when interrupting.
      if (self.check) {
        return nok(code)
      }

      kind = constants.htmlComplete
      return completeAttributeNameBefore(code)
    }

    if (code === codes.dash || asciiAlphanumeric(code)) {
      effects.consume(code)
      buffer += fromCharCode(lowercase(code))
      return tagName
    }

    return nok(code)
  }

  function basicSelfClosing(code) {
    if (code === codes.greaterThan) {
      effects.consume(code)
      return continuation
    }

    return nok(code)
  }

  function completeAttributeNameBefore(code) {
    if (markdownSpace(code)) {
      effects.consume(code)
      return completeAttributeNameBefore
    }

    if (startTag) {
      if (code === codes.slash) {
        effects.consume(code)
        return completeSelfClosing
      }

      if (
        code === codes.colon ||
        code === codes.underscore ||
        asciiAlpha(code)
      ) {
        effects.consume(code)
        return completeAttributeName
      }
    }

    if (code === codes.greaterThan) {
      effects.consume(code)
      return completeAfter
    }

    return nok(code)
  }

  function completeAttributeName(code) {
    if (
      code === codes.dash ||
      code === codes.dot ||
      code === codes.colon ||
      code === codes.underscore ||
      asciiAlphanumeric(code)
    ) {
      effects.consume(code)
      return completeAttributeName
    }

    return completeAttributeNameAfter
  }

  function completeAttributeNameAfter(code) {
    if (markdownSpace(code)) {
      effects.consume(code)
      return completeAttributeNameAfter
    }

    if (code === codes.equalsTo) {
      effects.consume(code)
      return completeAttributeValueBefore
    }

    return completeAttributeNameBefore(code)
  }

  function completeAttributeValueBefore(code) {
    if (
      code === codes.eof ||
      code === codes.lessThan ||
      code === codes.equalsTo ||
      code === codes.greaterThan ||
      code === codes.graveAccent
    ) {
      return nok(code)
    }

    if (markdownSpace(code)) {
      effects.consume(code)
      return completeAttributeValueBefore
    }

    if (code === codes.quotationMark || code === codes.apostrophe) {
      effects.consume(code)
      attributeMarker = code
      return completeAttributeValueQuoted
    }

    return completeAttributeValueUnquoted
  }

  function completeAttributeValueQuoted(code) {
    if (markdownEnding(code)) {
      return nok(code)
    }

    if (code === attributeMarker) {
      effects.consume(code)
      attributeMarker = undefined
      return completeAttributeValueQuotedAfter
    }

    effects.consume(code)
    return completeAttributeValueQuoted
  }

  function completeAttributeValueUnquoted(code) {
    if (
      markdownEndingOrSpace(code) ||
      code === codes.quotationMark ||
      code === codes.apostrophe ||
      code === codes.lessThan ||
      code === codes.equalsTo ||
      code === codes.greaterThan ||
      code === codes.graveAccent
    ) {
      return completeAttributeNameAfter(code)
    }

    effects.consume(code)
    return completeAttributeValueUnquoted
  }

  function completeAttributeValueQuotedAfter(code) {
    if (
      markdownSpace(code) ||
      code === codes.slash ||
      code === codes.greaterThan
    ) {
      return completeAttributeNameBefore(code)
    }

    return nok(code)
  }

  function completeSelfClosing(code) {
    if (code === codes.greaterThan) {
      effects.consume(code)
      return completeAfter
    }

    return nok(code)
  }

  function completeAfter(code) {
    if (markdownEndingOrSpace(code)) {
      return continuation(code)
    }

    return nok(code)
  }

  function continuation(code) {
    if (code === codes.eof) {
      effects.exit(types.htmlFlow)
      return ok(code)
    }

    if (kind === constants.htmlRaw && code === codes.lessThan) {
      effects.consume(code)
      return continuationRawTagOpen
    }

    if (kind === constants.htmlComment && code === codes.dash) {
      effects.consume(code)
      return continuationCommentInside
    }

    if (kind === constants.htmlInstruction && code === codes.questionMark) {
      effects.consume(code)
      return continuationDeclarationInside
    }

    if (kind === constants.htmlDeclaration && code === codes.greaterThan) {
      effects.consume(code)
      return continuationClose
    }

    if (kind === constants.htmlCdata && code === codes.rightSquareBracket) {
      effects.consume(code)
      return continuationCharacterDataInside
    }

    if (
      (kind === constants.htmlBasic || kind === constants.htmlComplete) &&
      markdownLineEnding(code)
    ) {
      return effects.isConstruct(blank, continuationClose, notBlank)
    }

    effects.consume(code)
    return continuation
  }

  function continuationCommentInside(code) {
    if (code === codes.dash) {
      effects.consume(code)
      return continuationDeclarationInside
    }

    return continuation(code)
  }

  function continuationRawTagOpen(code) {
    if (code === codes.slash) {
      effects.consume(code)
      buffer = ''
      return continuationRawEndTag
    }

    return continuation(code)
  }

  function continuationRawEndTag(code) {
    if (code === codes.greaterThan && raws.indexOf(buffer) !== -1) {
      effects.consume(code)
      return continuationClose
    }

    if (buffer.length < constants.htmlRawSizeMax && asciiAlpha(code)) {
      effects.consume(code)
      buffer += fromCharCode(lowercase(code))
      return continuationRawEndTag
    }

    return continuation(code)
  }

  function continuationCharacterDataInside(code) {
    if (code === codes.rightSquareBracket) {
      effects.consume(code)
      return continuationDeclarationInside
    }

    return continuation(code)
  }

  function continuationDeclarationInside(code) {
    if (code === codes.greaterThan) {
      effects.consume(code)
      return continuationClose
    }

    return continuation(code)
  }

  function continuationClose(code) {
    if (markdownEnding(code)) {
      effects.exit(types.htmlFlow)
      return ok(code)
    }

    effects.consume(code)
    return continuationClose
  }

  function notBlank(code) {
    assert(markdownLineEnding(code), 'expected EOL')
    effects.consume(code)
    return continuation
  }
}

function tokenizeBlank(effects, ok, nok) {
  return start

  function start(code) {
    assert(markdownLineEnding(code), 'expected EOL')
    effects.consume(code)
    return blank
  }

  function blank(code) {
    if (markdownSpace(code)) {
      effects.consume(code)
      return blank
    }

    if (markdownEnding(code)) {
      return ok(code)
    }

    return nok(code)
  }
}