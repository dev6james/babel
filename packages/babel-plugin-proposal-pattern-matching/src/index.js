import assert from "assert";
import { declare } from "@babel/helper-plugin-utils";
import syntaxPatternMatching from "@babel/plugin-syntax-pattern-matching";
import { types as t, template } from "../../babel-core";

const exprT = template.expression;

const constStatement = (id, initializer) =>
  t.variableDeclaration("const", [t.variableDeclarator(id, initializer)]);

const failIf = testExpr => t.ifStatement(testExpr, t.continueStatement(null));

class WhenRewriter {
  constructor({ stmts, scope }) {
    this.stmts = stmts;
    this.scope = scope;
  }

  bindConst(id, initializer) {
    this.stmts.push(constStatement(id, initializer));
  }

  failIf(testExpr) {
    this.stmts.push(failIf(testExpr));
  }

  rewriteNode(pattern, id) {
    const { scope } = this;

    switch (pattern.type) {
      case "NumericLiteral":
      case "StringLiteral":
      case "BooleanLiteral":
      case "NullLiteral":
        this.failIf(t.binaryExpression("!==", id, pattern));
        return;

      case "Identifier":
        this.bindConst(pattern, id);
        return;

      case "ObjectMatchPattern":
        this.failIf(
          exprT`ID === null || typeof ID === "undefined"`({ ID: id }),
        );
        for (const property of pattern.properties) {
          assert(property.type === "ObjectMatchProperty");
          const { key } = property;
          const subId = scope.generateUidIdentifier(key.name);
          this.bindConst(subId, exprT`ID.KEY`({ ID: id, KEY: key }));
          this.failIf(exprT`typeof SUBID === "undefined"`({ SUBID: subId }));
          this.rewriteNode(property.element || property.key, subId);
        }
        return;

      case "ArrayMatchPattern": {
        // TODO this is too specific
        this.failIf(exprT`!Array.isArray(ID)`({ ID: id }));

        const { elements } = pattern;
        if (
          elements.slice(0, -1).some(elt => elt.type === "MatchRestElement")
        ) {
          throw new Error("rest-pattern before end of array pattern");
        }
        const haveRest =
          elements.length > 0 &&
          elements[elements.length - 1].type === "MatchRestElement";

        const numElements = elements.length - (haveRest ? 1 : 0);
        if (!haveRest || numElements > 0) {
          this.failIf(
            t.binaryExpression(
              haveRest ? "<" : "!==",
              t.memberExpression(id, t.identifier("length")),
              t.numericLiteral(numElements),
            ),
          );
        }

        elements.slice(0, numElements).forEach((element, index) => {
          const subId = scope.generateUidIdentifier(index);
          this.bindConst(
            subId,
            exprT`ID[INDEX]`({ ID: id, INDEX: t.numericLiteral(index) }),
          );
          this.failIf(exprT`typeof SUBID === "undefined"`({ SUBID: subId }));
          this.rewriteNode(element, subId);
        });

        if (haveRest) {
          const subId = scope.generateUidIdentifier("rest");
          this.bindConst(
            subId,
            exprT`ID.slice(START)`({
              ID: id,
              START: t.numericLiteral(numElements),
            }),
          );
          this.rewriteNode(elements[elements.length - 1].body, subId);
        }

        return;
      }

      case "RegExpLiteral":
      default:
        // TODO better error; use path.buildCodeFrameError ?
        throw new Error("Bad expression in pattern");
    }
  }
}

export default declare(api => {
  api.assertVersion(7);

  const visitWhen = (
    whenNode,
    { discriminantId, stmts: outerStmts, outerLabel, scope },
  ) => {
    const { pattern, matchGuard, body } = whenNode;

    const stmts = [];
    new WhenRewriter({ stmts, scope }).rewriteNode(pattern, discriminantId);
    if (matchGuard !== undefined) {
      stmts.push(failIf(t.unaryExpression("!", matchGuard)));
    }
    stmts.push(body);
    stmts.push(t.continueStatement(outerLabel));
    outerStmts.push(template`do { STMTS } while (0);`({ STMTS: stmts }));
  };

  const caseVisitor = {
    CaseStatement(path) {
      const { discriminant, cases } = path.node;
      const { scope } = path;
      const outerLabel = scope.generateUidIdentifier("case");
      const discriminantId = scope.generateUidIdentifier("caseVal");

      const stmts = [];
      stmts.push(constStatement(discriminantId, discriminant));
      for (const whenNode of cases) {
        visitWhen(whenNode, { discriminantId, stmts, outerLabel, scope });
      }
      path.replaceWith(
        template`
          LABEL: do {STMTS} while (0);
        `({ LABEL: outerLabel, STMTS: stmts }),
      );
    },
  };

  return {
    name: "proposal-pattern-matching",
    inherits: syntaxPatternMatching,
    visitor: caseVisitor,
  };
});
