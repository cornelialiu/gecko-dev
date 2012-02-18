/* vim:set ts=2 sw=2 sts=2 et tw=80:
 * ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is the Source Editor component (Orion editor).
 *
 * The Initial Developer of the Original Code is
 * The Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Mihai Sucan <mihai.sucan@gmail.com> (original author)
 *   Kenny Heaton <kennyheaton@gmail.com>
 *   Spyros Livathinos <livathinos.spyros@gmail.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK *****/

"use strict";

const Cu = Components.utils;
const Ci = Components.interfaces;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource:///modules/source-editor-ui.jsm");

XPCOMUtils.defineLazyServiceGetter(this, "clipboardHelper",
                                   "@mozilla.org/widget/clipboardhelper;1",
                                   "nsIClipboardHelper");

const ORION_SCRIPT = "chrome://browser/content/orion.js";
const ORION_IFRAME = "data:text/html;charset=utf8,<!DOCTYPE html>" +
  "<html style='height:100%' dir='ltr'>" +
  "<head><link rel='stylesheet'" +
  " href='chrome://browser/skin/devtools/orion-container.css'></head>" +
  "<body style='height:100%;margin:0;overflow:hidden'>" +
  "<div id='editor' style='height:100%'></div>" +
  "</body></html>";

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

/**
 * Predefined themes for syntax highlighting. This objects maps
 * SourceEditor.THEMES to Orion CSS files.
 */
const ORION_THEMES = {
  mozilla: ["chrome://browser/skin/devtools/orion.css"],
};

/**
 * Known Orion editor events you can listen for. This object maps several of the
 * SourceEditor.EVENTS to Orion events.
 */
const ORION_EVENTS = {
  ContextMenu: "ContextMenu",
  TextChanged: "ModelChanged",
  Selection: "Selection",
  Focus: "Focus",
  Blur: "Blur",
  MouseOver: "MouseOver",
  MouseOut: "MouseOut",
  MouseMove: "MouseMove",
};

/**
 * Known Orion annotation types.
 */
const ORION_ANNOTATION_TYPES = {
  currentBracket: "orion.annotation.currentBracket",
  matchingBracket: "orion.annotation.matchingBracket",
  breakpoint: "orion.annotation.breakpoint",
  task: "orion.annotation.task",
};

/**
 * Default key bindings in the Orion editor.
 */
const DEFAULT_KEYBINDINGS = [
  {
    action: "undo",
    code: Ci.nsIDOMKeyEvent.DOM_VK_Z,
    accel: true,
  },
  {
    action: "redo",
    code: Ci.nsIDOMKeyEvent.DOM_VK_Z,
    accel: true,
    shift: true,
  },
  {
    action: "Unindent Lines",
    code: Ci.nsIDOMKeyEvent.DOM_VK_TAB,
    shift: true,
  },
];

var EXPORTED_SYMBOLS = ["SourceEditor"];

/**
 * The SourceEditor object constructor. The SourceEditor component allows you to
 * provide users with an editor tailored to the specific needs of editing source
 * code, aimed primarily at web developers.
 *
 * The editor used here is Eclipse Orion (see http://www.eclipse.org/orion).
 *
 * @constructor
 */
function SourceEditor() {
  // Update the SourceEditor defaults from user preferences.

  SourceEditor.DEFAULTS.tabSize =
    Services.prefs.getIntPref(SourceEditor.PREFS.TAB_SIZE);
  SourceEditor.DEFAULTS.expandTab =
    Services.prefs.getBoolPref(SourceEditor.PREFS.EXPAND_TAB);

  this._onOrionSelection = this._onOrionSelection.bind(this);

  this._eventTarget = {};
  this._eventListenersQueue = [];
  this.ui = new SourceEditorUI(this);
}

SourceEditor.prototype = {
  _view: null,
  _iframe: null,
  _model: null,
  _undoStack: null,
  _linesRuler: null,
  _annotationRuler: null,
  _overviewRuler: null,
  _styler: null,
  _annotationStyler: null,
  _annotationModel: null,
  _dragAndDrop: null,
  _mode: null,
  _expandTab: null,
  _tabSize: null,
  _iframeWindow: null,
  _eventTarget: null,
  _eventListenersQueue: null,

  /**
   * The Source Editor user interface manager.
   * @type object
   *       An instance of the SourceEditorUI.
   */
  ui: null,

  /**
   * The editor container element.
   * @type nsIDOMElement
   */
  parentElement: null,

  /**
   * Initialize the editor.
   *
   * @param nsIDOMElement aElement
   *        The DOM element where you want the editor to show.
   * @param object aConfig
   *        Editor configuration object. See SourceEditor.DEFAULTS for the
   *        available configuration options.
   * @param function [aCallback]
   *        Function you want to execute once the editor is loaded and
   *        initialized.
   * @see SourceEditor.DEFAULTS
   */
  init: function SE_init(aElement, aConfig, aCallback)
  {
    if (this._iframe) {
      throw new Error("SourceEditor is already initialized!");
    }

    let doc = aElement.ownerDocument;

    this._iframe = doc.createElementNS(XUL_NS, "iframe");
    this._iframe.flex = 1;

    let onIframeLoad = (function() {
      this._iframe.removeEventListener("load", onIframeLoad, true);
      this._onIframeLoad();
    }).bind(this);

    this._iframe.addEventListener("load", onIframeLoad, true);

    this._iframe.setAttribute("src", ORION_IFRAME);

    aElement.appendChild(this._iframe);
    this.parentElement = aElement;

    this._config = {};
    for (let key in SourceEditor.DEFAULTS) {
      this._config[key] = key in aConfig ?
                          aConfig[key] :
                          SourceEditor.DEFAULTS[key];
    }

    // TODO: Bug 725677 - Remove the deprecated placeholderText option from the
    // Source Editor initialization.
    if (aConfig.placeholderText) {
      this._config.initialText = aConfig.placeholderText;
      Services.console.logStringMessage("SourceEditor.init() was called with the placeholderText option which is deprecated, please use initialText.");
    }

    this._onReadyCallback = aCallback;
    this.ui.init();
  },

  /**
   * The editor iframe load event handler.
   * @private
   */
  _onIframeLoad: function SE__onIframeLoad()
  {
    this._iframeWindow = this._iframe.contentWindow.wrappedJSObject;
    let window = this._iframeWindow;
    let config = this._config;

    Services.scriptloader.loadSubScript(ORION_SCRIPT, window, "utf8");

    let TextModel = window.require("orion/textview/textModel").TextModel;
    let TextView = window.require("orion/textview/textView").TextView;

    this._expandTab = config.expandTab;
    this._tabSize = config.tabSize;

    let theme = config.theme;
    let stylesheet = theme in ORION_THEMES ? ORION_THEMES[theme] : theme;

    this._model = new TextModel(config.initialText);
    this._view = new TextView({
      model: this._model,
      parent: "editor",
      stylesheet: stylesheet,
      tabSize: this._tabSize,
      expandTab: this._expandTab,
      readonly: config.readOnly,
      themeClass: "mozilla" + (config.readOnly ? " readonly" : ""),
    });

    let onOrionLoad = function() {
      this._view.removeEventListener("Load", onOrionLoad);
      this._onOrionLoad();
    }.bind(this);

    this._view.addEventListener("Load", onOrionLoad);
    if (Services.appinfo.OS == "Linux") {
      this._view.addEventListener("Selection", this._onOrionSelection);
    }

    let KeyBinding = window.require("orion/textview/keyBinding").KeyBinding;
    let TextDND = window.require("orion/textview/textDND").TextDND;
    let Rulers = window.require("orion/textview/rulers");
    let LineNumberRuler = Rulers.LineNumberRuler;
    let AnnotationRuler = Rulers.AnnotationRuler;
    let OverviewRuler = Rulers.OverviewRuler;
    let UndoStack = window.require("orion/textview/undoStack").UndoStack;
    let AnnotationModel = window.require("orion/textview/annotations").AnnotationModel;

    this._annotationModel = new AnnotationModel(this._model);

    if (config.showAnnotationRuler) {
      this._annotationRuler = new AnnotationRuler(this._annotationModel, "left",
        {styleClass: "ruler annotations"});
      this._annotationRuler.onClick = this._annotationRulerClick.bind(this);
      this._annotationRuler.addAnnotationType(ORION_ANNOTATION_TYPES.breakpoint);
      this._annotationRuler.setMultiAnnotation({
        html: "<div class='annotationHTML multiple'></div>"
      });
      this._annotationRuler.setMultiAnnotationOverlay({
        html: "<div class='annotationHTML overlay'></div>"
      });
      this._view.addRuler(this._annotationRuler);
    }

    if (config.showLineNumbers) {
      let rulerClass = this._annotationRuler ?
                       "ruler lines linesWithAnnotations" :
                       "ruler lines";

      this._linesRuler = new LineNumberRuler(this._annotationModel, "left",
        {styleClass: rulerClass}, {styleClass: "rulerLines odd"},
        {styleClass: "rulerLines even"});

      this._view.addRuler(this._linesRuler);
    }

    if (config.showOverviewRuler) {
      this._overviewRuler = new OverviewRuler(this._annotationModel, "right",
        {styleClass: "ruler overview"});
      this._overviewRuler.onClick = this._overviewRulerClick.bind(this);

      this._overviewRuler.addAnnotationType(ORION_ANNOTATION_TYPES.matchingBracket);
      this._overviewRuler.addAnnotationType(ORION_ANNOTATION_TYPES.currentBracket);
      this._overviewRuler.addAnnotationType(ORION_ANNOTATION_TYPES.breakpoint);
      this._overviewRuler.addAnnotationType(ORION_ANNOTATION_TYPES.task);
      this._view.addRuler(this._overviewRuler);
    }

    this.setMode(config.mode);

    this._undoStack = new UndoStack(this._view, config.undoLimit);

    this._dragAndDrop = new TextDND(this._view, this._undoStack);

    let actions = {
      "undo": [this.undo, this],
      "redo": [this.redo, this],
      "tab": [this._doTab, this],
      "Unindent Lines": [this._doUnindentLines, this],
      "enter": [this._doEnter, this],
      "Find...": [this.ui.find, this.ui],
      "Find Next Occurrence": [this.ui.findNext, this.ui],
      "Find Previous Occurrence": [this.ui.findPrevious, this.ui],
      "Goto Line...": [this.ui.gotoLine, this.ui],
    };

    for (let name in actions) {
      let action = actions[name];
      this._view.setAction(name, action[0].bind(action[1]));
    }

    let keys = (config.keys || []).concat(DEFAULT_KEYBINDINGS);
    keys.forEach(function(aKey) {
      let binding = new KeyBinding(aKey.code, aKey.accel, aKey.shift, aKey.alt);
      this._view.setKeyBinding(binding, aKey.action);

      if (aKey.callback) {
        this._view.setAction(aKey.action, aKey.callback);
      }
    }, this);

    this._initEventTarget();
  },

  /**
   * Initialize the private Orion EventTarget object. This is used for tracking
   * our own event listeners for events outside of Orion's scope.
   * @private
   */
  _initEventTarget: function SE__initEventTarget()
  {
    let EventTarget =
      this._iframeWindow.require("orion/textview/eventTarget").EventTarget;
    EventTarget.addMixin(this._eventTarget);

    this._eventListenersQueue.forEach(function(aRequest) {
      if (aRequest[0] == "add") {
        this.addEventListener(aRequest[1], aRequest[2]);
      } else {
        this.removeEventListener(aRequest[1], aRequest[2]);
      }
    }, this);

    this._eventListenersQueue = [];
  },

  /**
   * Dispatch an event to the SourceEditor event listeners. This covers only the
   * SourceEditor-specific events.
   *
   * @private
   * @param object aEvent
   *        The event object to dispatch to all listeners.
   */
  _dispatchEvent: function SE__dispatchEvent(aEvent)
  {
    this._eventTarget.dispatchEvent(aEvent);
  },

  /**
   * The Orion "Load" event handler. This is called when the Orion editor
   * completes the initialization.
   * @private
   */
  _onOrionLoad: function SE__onOrionLoad()
  {
    this.ui.onReady();
    if (this._onReadyCallback) {
      this._onReadyCallback(this);
      this._onReadyCallback = null;
    }
  },

  /**
   * The "tab" editor action implementation. This adds support for expanded tabs
   * to spaces, and support for the indentation of multiple lines at once.
   * @private
   */
  _doTab: function SE__doTab()
  {
    let indent = "\t";
    let selection = this.getSelection();
    let model = this._model;
    let firstLine = model.getLineAtOffset(selection.start);
    let firstLineStart = model.getLineStart(firstLine);
    let lastLineOffset = selection.end > selection.start ?
                         selection.end - 1 : selection.end;
    let lastLine = model.getLineAtOffset(lastLineOffset);

    if (this._expandTab) {
      let offsetFromLineStart = firstLine == lastLine ?
                                selection.start - firstLineStart : 0;
      let spaces = this._tabSize - (offsetFromLineStart % this._tabSize);
      indent = (new Array(spaces + 1)).join(" ");
    }

    // Do selection indentation.
    if (firstLine != lastLine) {
      let lines = [""];
      let lastLineEnd = model.getLineEnd(lastLine, true);
      let selectedLines = lastLine - firstLine + 1;

      for (let i = firstLine; i <= lastLine; i++) {
        lines.push(model.getLine(i, true));
      }

      this.startCompoundChange();

      this.setText(lines.join(indent), firstLineStart, lastLineEnd);

      let newSelectionStart = firstLineStart == selection.start ?
                              selection.start : selection.start + indent.length;
      let newSelectionEnd = selection.end + (selectedLines * indent.length);

      this._view.setSelection(newSelectionStart, newSelectionEnd);

      this.endCompoundChange();
      return true;
    }

    return false;
  },

  /**
   * The "Unindent lines" editor action implementation. This method is invoked
   * when the user presses Shift-Tab.
   * @private
   */
  _doUnindentLines: function SE__doUnindentLines()
  {
    let indent = "\t";

    let selection = this.getSelection();
    let model = this._model;
    let firstLine = model.getLineAtOffset(selection.start);
    let lastLineOffset = selection.end > selection.start ?
                         selection.end - 1 : selection.end;
    let lastLine = model.getLineAtOffset(lastLineOffset);

    if (this._expandTab) {
      indent = (new Array(this._tabSize + 1)).join(" ");
    }

    let lines = [];
    for (let line, i = firstLine; i <= lastLine; i++) {
      line = model.getLine(i, true);
      if (line.indexOf(indent) != 0) {
        return true;
      }
      lines.push(line.substring(indent.length));
    }

    let firstLineStart = model.getLineStart(firstLine);
    let lastLineStart = model.getLineStart(lastLine);
    let lastLineEnd = model.getLineEnd(lastLine, true);

    this.startCompoundChange();

    this.setText(lines.join(""), firstLineStart, lastLineEnd);

    let selectedLines = lastLine - firstLine + 1;
    let newSelectionStart = firstLineStart == selection.start ?
                            selection.start :
                            Math.max(firstLineStart,
                                     selection.start - indent.length);
    let newSelectionEnd = selection.end - (selectedLines * indent.length) +
                          (selection.end == lastLineStart + 1 ? 1 : 0);
    if (firstLine == lastLine) {
      newSelectionEnd = Math.max(lastLineStart, newSelectionEnd);
    }
    this._view.setSelection(newSelectionStart, newSelectionEnd);

    this.endCompoundChange();

    return true;
  },

  /**
   * The editor Enter action implementation, which adds simple automatic
   * indentation based on the previous line when the user presses the Enter key.
   * @private
   */
  _doEnter: function SE__doEnter()
  {
    let selection = this.getSelection();
    if (selection.start != selection.end) {
      return false;
    }

    let model = this._model;
    let lineIndex = model.getLineAtOffset(selection.start);
    let lineText = model.getLine(lineIndex, true);
    let lineStart = model.getLineStart(lineIndex);
    let index = 0;
    let lineOffset = selection.start - lineStart;
    while (index < lineOffset && /[ \t]/.test(lineText.charAt(index))) {
      index++;
    }

    if (!index) {
      return false;
    }

    let prefix = lineText.substring(0, index);
    index = lineOffset;
    while (index < lineText.length &&
           /[ \t]/.test(lineText.charAt(index++))) {
      selection.end++;
    }

    this.setText(this.getLineDelimiter() + prefix, selection.start,
                 selection.end);
    return true;
  },

  /**
   * Orion Selection event handler for the X Window System users. This allows
   * one to select text and have it copied into the X11 PRIMARY.
   *
   * @private
   * @param object aEvent
   *        The Orion Selection event object.
   */
  _onOrionSelection: function SE__onOrionSelection(aEvent)
  {
    let text = this.getText(aEvent.newValue.start, aEvent.newValue.end);
    if (!text) {
      return;
    }

    clipboardHelper.copyStringToClipboard(text,
                                          Ci.nsIClipboard.kSelectionClipboard);
  },

  /**
   * Highlight the Orion annotations. This updates the annotation styler as
   * needed.
   * @private
   */
  _highlightAnnotations: function SE__highlightAnnotations()
  {
    if (this._annotationStyler) {
      this._annotationStyler.destroy();
      this._annotationStyler = null;
    }

    let AnnotationStyler =
      this._iframeWindow.require("orion/textview/annotations").AnnotationStyler;

    let styler = new AnnotationStyler(this._view, this._annotationModel);
    this._annotationStyler = styler;

    styler.addAnnotationType(ORION_ANNOTATION_TYPES.matchingBracket);
    styler.addAnnotationType(ORION_ANNOTATION_TYPES.currentBracket);
    styler.addAnnotationType(ORION_ANNOTATION_TYPES.task);
  },

  /**
   * Retrieve the list of Orion Annotations filtered by type for the given text range.
   *
   * @private
   * @param string aType
   *        The annotation type to filter annotations for.
   * @param number aStart
   *        Offset from where to start finding the annotations.
   * @param number aEnd
   *        End offset for retrieving the annotations.
   * @return array
   *         The array of annotations, filtered by type, within the given text
   *         range.
   */
  _getAnnotationsByType: function SE__getAnnotationsByType(aType, aStart, aEnd)
  {
    let annotations = this._annotationModel.getAnnotations(aStart, aEnd);
    let annotation, result = [];
    while (annotation = annotations.next()) {
      if (annotation.type == ORION_ANNOTATION_TYPES[aType]) {
        result.push(annotation);
      }
    }

    return result;
  },

  /**
   * The click event handler for the annotation ruler.
   *
   * @private
   * @param number aLineIndex
   *        The line index where the click event occurred.
   * @param object aEvent
   *        The DOM click event object.
   */
  _annotationRulerClick: function SE__annotationRulerClick(aLineIndex, aEvent)
  {
    if (aLineIndex === undefined || aLineIndex == -1) {
      return;
    }

    let lineStart = this._model.getLineStart(aLineIndex);
    let lineEnd = this._model.getLineEnd(aLineIndex);
    let annotations = this._getAnnotationsByType("breakpoint", lineStart, lineEnd);
    if (annotations.length > 0) {
      this.removeBreakpoint(aLineIndex);
    } else {
      this.addBreakpoint(aLineIndex);
    }
  },

  /**
   * The click event handler for the overview ruler. When the user clicks on an
   * annotation the editor jumps to the associated line.
   *
   * @private
   * @param number aLineIndex
   *        The line index where the click event occurred.
   * @param object aEvent
   *        The DOM click event object.
   */
  _overviewRulerClick: function SE__overviewRulerClick(aLineIndex, aEvent)
  {
    if (aLineIndex === undefined || aLineIndex == -1) {
      return;
    }

    let model = this._model;
    let lineStart = model.getLineStart(aLineIndex);
    let lineEnd = model.getLineEnd(aLineIndex);
    let annotations = this._annotationModel.getAnnotations(lineStart, lineEnd);
    let annotation = annotations.next();

    // Jump to the line where annotation is. If the annotation is specific to
    // a substring part of the line, then select the substring.
    if (!annotation || lineStart == annotation.start && lineEnd == annotation.end) {
      this.setSelection(lineStart, lineStart);
    } else {
      this.setSelection(annotation.start, annotation.end);
    }
  },

  /**
   * Get the editor element.
   *
   * @return nsIDOMElement
   *         In this implementation a xul:iframe holds the editor.
   */
  get editorElement() {
    return this._iframe;
  },

  /**
   * Add an event listener to the editor. You can use one of the known events.
   *
   * @see SourceEditor.EVENTS
   *
   * @param string aEventType
   *        The event type you want to listen for.
   * @param function aCallback
   *        The function you want executed when the event is triggered.
   */
  addEventListener: function SE_addEventListener(aEventType, aCallback)
  {
    if (this._view && aEventType in ORION_EVENTS) {
      this._view.addEventListener(ORION_EVENTS[aEventType], aCallback);
    } else if (this._eventTarget.addEventListener) {
      this._eventTarget.addEventListener(aEventType, aCallback);
    } else {
      this._eventListenersQueue.push(["add", aEventType, aCallback]);
    }
  },

  /**
   * Remove an event listener from the editor. You can use one of the known
   * events.
   *
   * @see SourceEditor.EVENTS
   *
   * @param string aEventType
   *        The event type you have a listener for.
   * @param function aCallback
   *        The function you have as the event handler.
   */
  removeEventListener: function SE_removeEventListener(aEventType, aCallback)
  {
    if (this._view && aEventType in ORION_EVENTS) {
      this._view.removeEventListener(ORION_EVENTS[aEventType], aCallback);
    } else if (this._eventTarget.removeEventListener) {
      this._eventTarget.removeEventListener(aEventType, aCallback);
    } else {
      this._eventListenersQueue.push(["remove", aEventType, aCallback]);
    }
  },

  /**
   * Undo a change in the editor.
   */
  undo: function SE_undo()
  {
    return this._undoStack.undo();
  },

  /**
   * Redo a change in the editor.
   */
  redo: function SE_redo()
  {
    return this._undoStack.redo();
  },

  /**
   * Check if there are changes that can be undone.
   *
   * @return boolean
   *         True if there are changes that can be undone, false otherwise.
   */
  canUndo: function SE_canUndo()
  {
    return this._undoStack.canUndo();
  },

  /**
   * Check if there are changes that can be repeated.
   *
   * @return boolean
   *         True if there are changes that can be repeated, false otherwise.
   */
  canRedo: function SE_canRedo()
  {
    return this._undoStack.canRedo();
  },

  /**
   * Reset the Undo stack
   */
  resetUndo: function SE_resetUndo()
  {
    this._undoStack.reset();
  },

  /**
   * Start a compound change in the editor. Compound changes are grouped into
   * only one change that you can undo later, after you invoke
   * endCompoundChange().
   */
  startCompoundChange: function SE_startCompoundChange()
  {
    this._undoStack.startCompoundChange();
  },

  /**
   * End a compound change in the editor.
   */
  endCompoundChange: function SE_endCompoundChange()
  {
    this._undoStack.endCompoundChange();
  },

  /**
   * Focus the editor.
   */
  focus: function SE_focus()
  {
    this._view.focus();
  },

  /**
   * Get the first visible line number.
   *
   * @return number
   *         The line number, counting from 0.
   */
  getTopIndex: function SE_getTopIndex()
  {
    return this._view.getTopIndex();
  },

  /**
   * Set the first visible line number.
   *
   * @param number aTopIndex
   *         The line number, counting from 0.
   */
  setTopIndex: function SE_setTopIndex(aTopIndex)
  {
    this._view.setTopIndex(aTopIndex);
  },

  /**
   * Check if the editor has focus.
   *
   * @return boolean
   *         True if the editor is focused, false otherwise.
   */
  hasFocus: function SE_hasFocus()
  {
    return this._view.hasFocus();
  },

  /**
   * Get the editor content, in the given range. If no range is given you get
   * the entire editor content.
   *
   * @param number [aStart=0]
   *        Optional, start from the given offset.
   * @param number [aEnd=content char count]
   *        Optional, end offset for the text you want. If this parameter is not
   *        given, then the text returned goes until the end of the editor
   *        content.
   * @return string
   *         The text in the given range.
   */
  getText: function SE_getText(aStart, aEnd)
  {
    return this._view.getText(aStart, aEnd);
  },

  /**
   * Get the number of characters in the editor content.
   *
   * @return number
   *         The number of editor content characters.
   */
  getCharCount: function SE_getCharCount()
  {
    return this._model.getCharCount();
  },

  /**
   * Get the selected text.
   *
   * @return string
   *         The currently selected text.
   */
  getSelectedText: function SE_getSelectedText()
  {
    let selection = this.getSelection();
    return this.getText(selection.start, selection.end);
  },

  /**
   * Replace text in the source editor with the given text, in the given range.
   *
   * @param string aText
   *        The text you want to put into the editor.
   * @param number [aStart=0]
   *        Optional, the start offset, zero based, from where you want to start
   *        replacing text in the editor.
   * @param number [aEnd=char count]
   *        Optional, the end offset, zero based, where you want to stop
   *        replacing text in the editor.
   */
  setText: function SE_setText(aText, aStart, aEnd)
  {
    this._view.setText(aText, aStart, aEnd);
  },

  /**
   * Drop the current selection / deselect.
   */
  dropSelection: function SE_dropSelection()
  {
    this.setCaretOffset(this.getCaretOffset());
  },

  /**
   * Select a specific range in the editor.
   *
   * @param number aStart
   *        Selection range start.
   * @param number aEnd
   *        Selection range end.
   */
  setSelection: function SE_setSelection(aStart, aEnd)
  {
    this._view.setSelection(aStart, aEnd, true);
  },

  /**
   * Get the current selection range.
   *
   * @return object
   *         An object with two properties, start and end, that give the
   *         selection range (zero based offsets).
   */
  getSelection: function SE_getSelection()
  {
    return this._view.getSelection();
  },

  /**
   * Get the current caret offset.
   *
   * @return number
   *         The current caret offset.
   */
  getCaretOffset: function SE_getCaretOffset()
  {
    return this._view.getCaretOffset();
  },

  /**
   * Set the caret offset.
   *
   * @param number aOffset
   *        The new caret offset you want to set.
   */
  setCaretOffset: function SE_setCaretOffset(aOffset)
  {
    this._view.setCaretOffset(aOffset, true);
  },

  /**
   * Get the caret position.
   *
   * @return object
   *         An object that holds two properties:
   *         - line: the line number, counting from 0.
   *         - col: the column number, counting from 0.
   */
  getCaretPosition: function SE_getCaretPosition()
  {
    let offset = this.getCaretOffset();
    let line = this._model.getLineAtOffset(offset);
    let lineStart = this._model.getLineStart(line);
    let column = offset - lineStart;
    return {line: line, col: column};
  },

  /**
   * Set the caret position: line and column.
   *
   * @param number aLine
   *        The new caret line location. Line numbers start from 0.
   * @param number [aColumn=0]
   *        Optional. The new caret column location. Columns start from 0.
   */
  setCaretPosition: function SE_setCaretPosition(aLine, aColumn)
  {
    this.setCaretOffset(this._model.getLineStart(aLine) + (aColumn || 0));
  },

  /**
   * Get the line count.
   *
   * @return number
   *         The number of lines in the document being edited.
   */
  getLineCount: function SE_getLineCount()
  {
    return this._model.getLineCount();
  },

  /**
   * Get the line delimiter used in the document being edited.
   *
   * @return string
   *         The line delimiter.
   */
  getLineDelimiter: function SE_getLineDelimiter()
  {
    return this._model.getLineDelimiter();
  },

  /**
   * Get the indentation string used in the document being edited.
   *
   * @return string
   *         The indentation string.
   */
  getIndentationString: function SE_getIndentationString()
  {
    if (this._expandTab) {
      return (new Array(this._tabSize + 1)).join(" ");
    }
    return "\t";
  },

  /**
   * Set the source editor mode to the file type you are editing.
   *
   * @param string aMode
   *        One of the predefined SourceEditor.MODES.
   */
  setMode: function SE_setMode(aMode)
  {
    if (this._styler) {
      this._styler.destroy();
      this._styler = null;
    }

    let window = this._iframeWindow;

    switch (aMode) {
      case SourceEditor.MODES.JAVASCRIPT:
      case SourceEditor.MODES.CSS:
        let TextStyler =
          window.require("examples/textview/textStyler").TextStyler;

        this._styler = new TextStyler(this._view, aMode, this._annotationModel);
        this._styler.setFoldingEnabled(false);
        this._styler.setHighlightCaretLine(true);
        break;

      case SourceEditor.MODES.HTML:
      case SourceEditor.MODES.XML:
        let TextMateStyler =
          window.require("orion/editor/textMateStyler").TextMateStyler;
        let HtmlGrammar =
          window.require("orion/editor/htmlGrammar").HtmlGrammar;
        this._styler = new TextMateStyler(this._view, new HtmlGrammar());
        break;
    }

    this._highlightAnnotations();
    this._mode = aMode;
  },

  /**
   * Get the current source editor mode.
   *
   * @return string
   *         Returns one of the predefined SourceEditor.MODES.
   */
  getMode: function SE_getMode()
  {
    return this._mode;
  },

  /**
   * Setter for the read-only state of the editor.
   * @param boolean aValue
   *        Tells if you want the editor to read-only or not.
   */
  set readOnly(aValue)
  {
    this._view.setOptions({
      readonly: aValue,
      themeClass: "mozilla" + (aValue ? " readonly" : ""),
    });
  },

  /**
   * Getter for the read-only state of the editor.
   * @type boolean
   */
  get readOnly()
  {
    return this._view.getOptions("readonly");
  },

  /**
   * Add a breakpoint at the given line index.
   *
   * @param number aLineIndex
   *        Line index where to add the breakpoint (starts from 0).
   * @param string [aCondition]
   *        Optional breakpoint condition.
   */
  addBreakpoint: function SE_addBreakpoint(aLineIndex, aCondition)
  {
    let lineStart = this._model.getLineStart(aLineIndex);
    let lineEnd = this._model.getLineEnd(aLineIndex);

    let annotations = this._getAnnotationsByType("breakpoint", lineStart, lineEnd);
    if (annotations.length > 0) {
      return;
    }

    let lineText = this._model.getLine(aLineIndex);
    let title = SourceEditorUI.strings.
                formatStringFromName("annotation.breakpoint.title",
                                     [lineText], 1);

    let annotation = {
      type: ORION_ANNOTATION_TYPES.breakpoint,
      start: lineStart,
      end: lineEnd,
      breakpointCondition: aCondition,
      title: title,
      style: {styleClass: "annotation breakpoint"},
      html: "<div class='annotationHTML breakpoint'></div>",
      overviewStyle: {styleClass: "annotationOverview breakpoint"},
      rangeStyle: {styleClass: "annotationRange breakpoint"}
    };
    this._annotationModel.addAnnotation(annotation);

    let event = {
      type: SourceEditor.EVENTS.BREAKPOINT_CHANGE,
      added: [{line: aLineIndex, condition: aCondition}],
      removed: [],
    };

    this._dispatchEvent(event);
  },

  /**
   * Remove the current breakpoint from the given line index.
   *
   * @param number aLineIndex
   *        Line index from where to remove the breakpoint (starts from 0).
   * @return boolean
   *         True if a breakpoint was removed, false otherwise.
   */
  removeBreakpoint: function SE_removeBreakpoint(aLineIndex)
  {
    let lineStart = this._model.getLineStart(aLineIndex);
    let lineEnd = this._model.getLineEnd(aLineIndex);

    let event = {
      type: SourceEditor.EVENTS.BREAKPOINT_CHANGE,
      added: [],
      removed: [],
    };

    let annotations = this._getAnnotationsByType("breakpoint", lineStart, lineEnd);

    annotations.forEach(function(annotation) {
      this._annotationModel.removeAnnotation(annotation);
      event.removed.push({line: aLineIndex,
                          condition: annotation.breakpointCondition});
    }, this);

    if (event.removed.length > 0) {
      this._dispatchEvent(event);
    }

    return event.removed.length > 0;
  },

  /**
   * Get the list of breakpoints in the Source Editor instance.
   *
   * @return array
   *         The array of breakpoints. Each item is an object with two
   *         properties: line and condition.
   */
  getBreakpoints: function SE_getBreakpoints()
  {
    let annotations = this._getAnnotationsByType("breakpoint", 0,
                                                 this.getCharCount());
    let breakpoints = [];

    annotations.forEach(function(annotation) {
      breakpoints.push({line: this._model.getLineAtOffset(annotation.start),
                        condition: annotation.breakpointCondition});
    }, this);

    return breakpoints;
  },

  /**
   * Destroy/uninitialize the editor.
   */
  destroy: function SE_destroy()
  {
    if (Services.appinfo.OS == "Linux") {
      this._view.removeEventListener("Selection", this._onOrionSelection);
    }
    this._onOrionSelection = null;

    this._view.destroy();
    this.ui.destroy();
    this.ui = null;

    this.parentElement.removeChild(this._iframe);
    this.parentElement = null;
    this._iframeWindow = null;
    this._iframe = null;
    this._undoStack = null;
    this._styler = null;
    this._linesRuler = null;
    this._annotationRuler = null;
    this._overviewRuler = null;
    this._dragAndDrop = null;
    this._annotationModel = null;
    this._annotationStyler = null;
    this._eventTarget = null;
    this._eventListenersQueue = null;
    this._view = null;
    this._model = null;
    this._config = null;
    this._lastFind = null;
  },
};
