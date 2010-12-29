
/*!
 * CSS - Evaluator
 * Copyright(c) 2010 LearnBoost <dev@learnboost.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var Visitor = require('./')
  , nodes = require('../nodes')
  , Stack = require('../stack')
  , Frame = require('../stack/frame')
  , Scope = require('../stack/scope')
  , utils = require('../utils')
  , bifs = require('../functions');

/**
 * Initialize a new `Evaluator` with the given `root` Node
 * and the following `options`.
 *
 * Options:
 *
 *   - `compress`  Compress the css output, defaults to false
 *
 * @param {Node} root
 * @api public
 */

var Evaluator = module.exports = function Evaluator(root, options) {
  options = options || {};
  Visitor.call(this, root);
  this.stack = new Stack;
  this.functions = options.functions || {};
  this.stack.push(this.global = new Frame(root));
};

/**
 * Inherit from `Visitor.prototype`.
 */

Evaluator.prototype.__proto__ = Visitor.prototype;

/**
 * Evaluate the tree.
 *
 * @return {Node}
 * @api public
 */

Evaluator.prototype.evaluate = function(){
  return this.visit(this.root);
};

/**
 * Visit Root.
 */

Evaluator.prototype.visitRoot = function(block){
  for (var i = 0, len = block.nodes.length; i < len; ++i) {
    block.nodes[i] = this.visit(block.nodes[i]);
  }
  return block;
};

/**
 * Visit Block.
 */

Evaluator.prototype.visitBlock = function(block){
  this.stack.push(new Frame(block));
  for (var i = 0, len = block.nodes.length; i < len; ++i) {
    block.nodes[i] = this.visit(block.nodes[i]);
  }
  this.stack.pop();
  return block;
};

/**
 * Visit Color.
 */

Evaluator.prototype.visitColor = function(color){
  return color;
};

/**
 * Visit HSLA.
 */

Evaluator.prototype.visitHSLA = function(hsla){
  return hsla;
};

/**
 * Visit Boolean.
 */

Evaluator.prototype.visitBoolean = function(bool){
  return bool;
};

/**
 * Visit Unit.
 */

Evaluator.prototype.visitUnit = function(unit){
  return unit;
};

/**
 * Visit Ident.
 */

Evaluator.prototype.visitIdent = function(id){
  return id;
};

/**
 * Visit String.
 */

Evaluator.prototype.visitString = function(string){
  return string;
};

/**
 * Visit Null.
 */

Evaluator.prototype.visitNull = function(node){
  return node;
};

/**
 * Visit Function.
 */

Evaluator.prototype.visitFunction = function(fn){
  return nodes.null;
};

/**
 * Visit Selector.
 */

Evaluator.prototype.visitSelector = function(selector){
  selector.block = this.visit(selector.block);
  return selector;
};

/**
 * Visit Call.
 */

Evaluator.prototype.visitCall = function(call){
  // TODO: refactor
  var fn = this.lookupFunction(call.name);

  // Undefined function, render literal css
  if (!fn) return call;

  var ret, body
    , params = fn.params
    , stack = this.stack;

  this.lookup = true;
  var args = this.visit(call.args);
  this.lookup = false;

  // Built-in
  if ('function' == typeof fn) {
    args = args.nodes.map(function(node){
      return node.first;
    });
    body = fn.apply(this, args);
    if (!(body instanceof nodes.Expression)) {
      var expr = new nodes.Expression;
      expr.push(body);
      body = expr;
    }
  // User-defined
  } else if (fn instanceof nodes.Function) {
    body = fn.block.clone();

    // Inject arguments as locals
    stack.push(new Frame(body));
    params.nodes.forEach(function(node, i){
      node.val = args.nodes[i] || node.val;
      if (node.val instanceof nodes.Null) {
        throw new Error('argument ' + node + ' required for ' + fn);
      }
      stack.currentFrame.scope.add(node);
    });

    // Evaluate
    this.lookup = true;
    body = this.visit(body);
    this.lookup = false;
    stack.pop();
  } else {
    throw new Error('cannot call ' + fn.first);
  }

  // Return
  if (this.return) {
    ret = body.nodes[body.nodes.length - 1];
  // Mixin
  } else {
    body.nodes.forEach(function(node){
      stack.currentFrame.block.nodes.push(node);
    });
    ret = nodes.null;
  }

  return ret;
};

/**
 * Visit Variable.
 */

Evaluator.prototype.visitVariable = function(variable){
  if (this.lookup) {
    var val = this.stack.lookup(variable.name);
    if (!val) throw new Error('undefined variable ' + variable);
    return this.visit(val);
  } else {
    this.stack.currentFrame.scope.add(variable);
    return nodes.null;
  }
};

/**
 * Visit BinOp.
 */

Evaluator.prototype.visitBinOp = function(binop){
  // Special-case "is defined" pseudo binop
  if ('is defined' == binop.op) return this.isDefined(binop.left);

  // Visit operands
  var op = binop.op
    , left = this.visit(binop.left).first
    , right = this.visit(binop.right).first;

  // Coercion
  var ignore = ['||', '&&', 'is a'];
  if (!~ignore.indexOf(op)) {
    if (right.nodeName != left.nodeName) {
      right = left.coerce(right);
    }
  }

  // Operate
  return this.visit(left.operate(op, right));
};

/**
 * Visit UnaryOp.
 */

Evaluator.prototype.visitUnaryOp = function(unary){
  var op = unary.op
    , node = this.visit(unary.expr).first;

  if ('!' != op) utils.assertType(node, nodes.Unit);

  switch (op) {
    case '-':
      node.val = -node.val;
      break;
    case '+':
      node.val = +node.val;
      break;
    case '~':
      node.val = ~node.val;
      break;
    case '!':
      return node.toBoolean().negate();
  }
  
  return node;
};

/**
 * Visit TernaryOp.
 */

Evaluator.prototype.visitTernary = function(ternary){
  var ok = this.visit(ternary.cond).toBoolean();
  return nodes.true == ok
    ? this.visit(ternary.trueExpr)
    : this.visit(ternary.falseExpr);
};


/**
 * Visit Expression.
 */

Evaluator.prototype.visitExpression = function(expr){
  for (var i = 0, len = expr.nodes.length; i < len; ++i) {
    expr.nodes[i] = this.visit(expr.nodes[i]);
  }
  return expr;
};

/**
 * Visit Property.
 */

Evaluator.prototype.visitProperty = function(prop){
  var fn = this.stack.lookup(prop.name)
    , call = fn instanceof nodes.Function
    , literal = prop.name == this.callingProperty;

  // Function of the same name
  if (call && !literal) {
    this.callingProperty = prop.name;
    var ret = this.visit(new nodes.Call(prop.name, prop.expr));
    this.callingProperty = null;
    return ret;
  // Regular property
  } else {
    // TODO: abstract this repeated state logic
    var lookup = this.lookup
      , ret = this.return;
    this.lookup = true;
    this.return = true;
    prop.expr = this.visit(prop.expr);
    this.return = ret;
    this.lookup = lookup;
  }
  return prop;
};

/**
 * Lookup function by the given `name`.
 *
 * @param {String} name
 * @return {Function}
 * @api public
 */

Evaluator.prototype.lookupFunction = function(name){
  return this.stack.lookup(name)
    || this.functions[name]
    || bifs[name];
};

/**
 * Check if the given `node` is a variable, and if it is defined.
 *
 * @param {Node} node
 * @return {Boolean}
 * @api private
 */

Evaluator.prototype.isDefined = function(node){
  if (node instanceof nodes.Variable) {
    return nodes.Boolean(this.stack.lookup(node.name));
  } else {
    throw new Error('invalid "is defined" check on non-variable ' + node);
  }
};