import matter from "gray-matter";
import minimatch from "minimatch";
import _ from "lodash";
import moment from "moment";
import YAML from "yamljs";
import { ENGINE_ERROR_CODES } from "./constants";
import { DendronError } from "./error";
import { DNode } from "./node";
import {
  DNodeOptsV2,
  DNodePropsDictV2,
  DNodePropsQuickInputV2,
  DNodePropsV2,
  NoteOptsV2,
  NotePropsDictV2,
  NotePropsV2,
  SchemaDataV2,
  SchemaModuleDictV2,
  SchemaModuleOptsV2,
  SchemaModulePropsV2,
  SchemaOptsV2,
  SchemaPropsDictV2,
  SchemaPropsV2,
} from "./typesv2";
import { genUUID } from "./uuid";

export class DNodeUtilsV2 {
  static addChild(parent: DNodePropsV2, child: DNodePropsV2) {
    parent.children = Array.from(new Set(parent.children).add(child.id));
    child.parent = parent.id;
  }

  static create(opts: DNodeOptsV2): DNodePropsV2 {
    const {
      id,
      type,
      desc,
      fname,
      updated,
      created,
      parent,
      stub,
      children,
      body,
      data,
    } = _.defaults(opts, {
      updated: moment.now(),
      created: moment.now(),
      id: genUUID(),
      desc: "",
      children: [],
      parent: null,
      body: "",
      data: {},
      fname: null,
    });
    const title = opts.title || DNode.defaultTitle(fname);
    const cleanProps: DNodePropsV2 = {
      id,
      title,
      type,
      desc,
      fname,
      updated,
      created,
      parent,
      children,
      body,
      data,
    };
    if (stub) {
      cleanProps.stub = stub;
    }
    const denylist = ["schemaStub", "type"];
    const custom = _.omit(opts, _.keys(cleanProps).concat(denylist));
    if (!_.isEmpty(custom)) {
      cleanProps.custom = custom;
    }
    return cleanProps;
  }

  static dirName(nodePath: string) {
    return nodePath.split(".").slice(0, -1).join(".");
  }

  static enhancePropForQuickInput(props: DNodePropsV2): DNodePropsQuickInputV2 {
    return { ...props, label: props.title.toLowerCase() };
  }

  static enhancePropsForQuickInput(
    props: DNodePropsV2[]
  ): DNodePropsQuickInputV2[] {
    return props.map(DNodeUtilsV2.enhancePropForQuickInput);
  }

  static findClosestParent(fpath: string, nodes: DNodePropsV2[]): DNodePropsV2 {
    const dirname = DNodeUtilsV2.dirName(fpath);
    if (dirname === "") {
      return _.find(nodes, { id: "root" }) as DNodePropsV2;
    }
    const maybeNode = _.find(nodes, { fname: dirname });
    if (maybeNode) {
      return maybeNode;
    } else {
      return DNodeUtilsV2.findClosestParent(dirname, nodes);
    }
  }

  static getDomain(
    node: DNodePropsV2,
    opts: {
      nodeDict: DNodePropsDictV2;
    }
  ): DNodePropsV2 {
    if (node.id === "root") {
      throw Error("root has no domain");
    }
    if (node.parent === "root") {
      return node;
    } else {
      return DNodeUtilsV2.getDomain(DNodeUtilsV2.getParent(node, opts), opts);
    }
  }

  static getParent(
    node: DNodePropsV2,
    opts: {
      nodeDict: DNodePropsDictV2;
    }
  ): DNodePropsV2 {
    if (node.id === "root") {
      throw Error("root has no parent");
    }
    const parent = opts.nodeDict[node.parent as string];
    if (_.isUndefined(parent)) {
      throw Error(`parent ${node.parent} not found`);
    }
    return parent;
  }

  static getChildren(
    node: DNodePropsV2,
    opts: {
      recursive?: boolean;
      nodeDict: DNodePropsDictV2;
    }
  ): DNodePropsV2[] {
    const { nodeDict, recursive } = opts;
    const children = node.children.map((id) => {
      if (!_.has(nodeDict, id)) {
        throw Error("child nod found");
      }
      return nodeDict[id];
    });
    if (recursive) {
      return children.concat(
        children.map((c) => DNodeUtilsV2.getChildren(c, opts)).flat()
      );
    }
    return children;
  }
}

export class NoteUtilsV2 {
  static addParent(opts: {
    note: NotePropsV2;
    notesList: NotePropsV2[];
    createStubs: boolean;
  }): NotePropsV2[] {
    const { note, notesList, createStubs } = opts;
    const parentPath = DNodeUtilsV2.dirName(note.fname);
    let parent = _.find(notesList, (p) => p.fname === parentPath) || null;
    const stubs: NotePropsV2[] = [];
    if (!parent && !createStubs) {
      const err = {
        status: ENGINE_ERROR_CODES.NO_PARENT_FOR_NOTE,
        msg: JSON.stringify({
          fname: note.fname,
        }),
      };
      throw new DendronError(err);
    }
    if (!parent) {
      parent = DNodeUtilsV2.findClosestParent(
        note.fname,
        notesList
      ) as NotePropsV2;
      const stubNodes = NoteUtilsV2.createStubs(parent, note);
      stubNodes.forEach((ent2) => {
        stubs.push(ent2);
      });
    }
    DNodeUtilsV2.addChild(parent, note);
    return stubs;
  }

  static addSchema(opts: {
    note: NotePropsV2;
    schemaModule: SchemaModulePropsV2;
    schema: SchemaPropsV2;
  }) {
    const { note, schema, schemaModule } = opts;
    note.schema = { schemaId: schema.id, moduleId: schemaModule.root.id };
  }

  static create(opts: NoteOptsV2): NotePropsV2 {
    const cleanOpts = _.defaults(opts, {
      schemaStub: false,
    });
    return DNodeUtilsV2.create({ ...cleanOpts, type: "note" });
  }

  static createRoot(opts: Partial<NoteOptsV2>): NotePropsV2 {
    return DNodeUtilsV2.create({
      ...opts,
      type: "note",
      fname: "root",
      id: "root",
    });
  }

  static createStubs(from: NotePropsV2, to: NotePropsV2): NotePropsV2[] {
    const stubNodes: NotePropsV2[] = [];
    let fromPath = from.fname;
    if (from.id === "root") {
      fromPath = "";
    }
    const toPath = to.fname;
    const index = toPath.indexOf(fromPath) + fromPath.length;
    const diffPath = _.trimStart(toPath.slice(index), ".").split(".");
    let stubPath = fromPath;
    let parent = from;
    // last element is node
    diffPath.slice(0, -1).forEach((part) => {
      // handle starting from root, path = ""
      if (_.isEmpty(stubPath)) {
        stubPath = part;
      } else {
        stubPath += `.${part}`;
      }
      const n = NoteUtilsV2.create({ fname: stubPath, stub: true });
      stubNodes.push(n);
      DNodeUtilsV2.addChild(parent, n);
      parent = n;
    });
    DNodeUtilsV2.addChild(parent, to);
    return stubNodes;
  }

  static getNoteByFname(
    fname: string,
    notes: NotePropsDictV2,
    opts?: { throwIfEmpty: boolean }
  ): NotePropsV2 | undefined {
    const out = _.find(
      _.values(notes),
      (ent) => ent.fname.toLowerCase() === fname
    );
    if (opts?.throwIfEmpty && _.isUndefined(out)) {
      throw Error(`${fname} not found`);
    }
    return out;
  }

  static serialize(props: NotePropsV2): string {
    const body = props.body;
    const builtinProps = _.pick(props, [
      "id",
      "title",
      "desc",
      "updated",
      "created",
      "stub",
    ]);
    const { custom: customProps } = props;
    const meta = { ...builtinProps, ...customProps };
    return matter.stringify(body || "", meta);
  }
}

type SchemaMatchResult = {
  schema: SchemaPropsV2;
  namespace: boolean;
  note: NotePropsV2;
};

export class SchemaUtilsV2 {
  static create(opts: SchemaOptsV2): SchemaPropsV2 {
    if (opts.fname.indexOf(".schema") < 0) {
      opts.fname += ".schema";
    }
    const schemaDataOpts: (keyof SchemaDataV2)[] = [
      "namespace",
      "pattern",
      "template",
    ];
    const optsWithoutData = _.omit(opts, schemaDataOpts) as SchemaOptsV2;
    const optsData = _.pick(opts, schemaDataOpts);
    return DNodeUtilsV2.create({
      ..._.defaults(optsWithoutData, {
        title: optsWithoutData.id,
        data: optsData,
      }),
      type: "schema",
    });
  }

  static createModule(opts: SchemaModuleOptsV2): SchemaModuleOptsV2 {
    return opts;
  }

  static createRootModule(opts?: Partial<SchemaPropsV2>): SchemaModuleOptsV2 {
    const schema = SchemaUtilsV2.create({
      id: "root",
      title: "root",
      fname: "root.schema",
      parent: null,
      children: [],
      ...opts,
    });
    return {
      version: 1,
      imports: [],
      schemas: [schema],
    };
  }

  static getModuleFname(module: SchemaModuleOptsV2): string {
    return SchemaUtilsV2.getModuleRoot(module).fname;
  }

  static getModuleRoot(module: SchemaModuleOptsV2): SchemaPropsV2 {
    const maybeRoot = _.find(module.schemas, { parent: "root" });
    if (!maybeRoot) {
      const rootSchemaRoot = _.find(module.schemas, {
        parent: null,
        id: "root",
      });
      if (!rootSchemaRoot) {
        throw new DendronError({
          status: ENGINE_ERROR_CODES.NO_ROOT_SCHEMA_FOUND,
        });
      } else {
        return rootSchemaRoot as SchemaPropsV2;
      }
    }
    return maybeRoot as SchemaPropsV2;
  }

  static matchDomain(
    domain: NotePropsV2,
    notes: NotePropsDictV2,
    schemas: SchemaModuleDictV2
  ) {
    const match = schemas[domain.fname];
    if (!match) {
      return;
    } else {
      const domainSchema = match.root;
      return SchemaUtilsV2.matchDomainWithSchema({
        noteCandidates: [domain],
        notes,
        schemaCandidates: [domainSchema],
        schemaModule: match,
      });
    }
  }

  static matchDomainWithSchema(opts: {
    noteCandidates: NotePropsV2[];
    notes: NotePropsDictV2;
    schemaCandidates: SchemaPropsV2[];
    schemaModule: SchemaModulePropsV2;
  }) {
    const { noteCandidates, schemaCandidates, notes, schemaModule } = opts;
    const matches = _.map(noteCandidates, (note) => {
      return SchemaUtilsV2.matchPathWithSchema({
        note,
        schemas: schemaCandidates,
        schemaDict: schemaModule.schemas,
      });
    }).filter((ent) => !_.isUndefined(ent)) as SchemaMatchResult[];

    matches.map((m) => {
      const { schema, note } = m;
      NoteUtilsV2.addSchema({ note, schema, schemaModule });

      // if namespace, create fake intermediary note
      const nextSchemaCandidates = schema.data.namespace
        ? [
            SchemaUtilsV2.create({
              data: { pattern: "*" },
              fname: schemaModule.fname,
              children: schema.children,
              parent: schema.id,
            }),
          ]
        : schema.children.map((id) => schemaModule.schemas[id]);
      const nextNoteCandidates = note.children.map((id) => notes[id]);
      return SchemaUtilsV2.matchDomainWithSchema({
        noteCandidates: nextNoteCandidates,
        schemaCandidates: nextSchemaCandidates,
        notes,
        schemaModule,
      });
    });
  }

  static matchPathWithSchema(opts: {
    note: NotePropsV2;
    schemas: SchemaPropsV2[];
    schemaDict: SchemaPropsDictV2;
    matchNamespace?: boolean;
  }): SchemaMatchResult | undefined {
    const getPattern = (
      schema: SchemaPropsV2,
      schemas: SchemaPropsDictV2
    ): string => {
      const pattern = schema.data.pattern || schema.id;
      const part = schema.data.namespace ? `${pattern}/*` : pattern;
      if (_.isNull(schema.parent)) {
        return part;
      }
      const parent: SchemaPropsV2 = schemas[schema.parent];
      if (parent && parent.data.pattern !== "root") {
        const prefix = getPattern(parent, schemas);
        return [prefix, part].join("/");
      } else {
        return part;
      }
    };

    const { note, schemas, schemaDict, matchNamespace } = opts;
    const notePath = note.fname;
    const notePathClean = notePath.replace(/\./g, "/");
    let namespace = false;
    let match = _.find(schemas, (sc) => {
      const pattern = getPattern(sc, schemaDict);
      if (sc.data.namespace && matchNamespace) {
        namespace = true;
        return minimatch(notePathClean, _.trimEnd(pattern, "/*"));
      } else {
        return minimatch(notePathClean, pattern);
      }
    });
    if (match) {
      return {
        schema: match,
        namespace,
        note,
      };
    }
    return;
  }

  static serializeModule(moduleProps: SchemaModuleOptsV2) {
    const { version, imports, schemas } = moduleProps;
    const out = {
      version,
      imports,
      schemas,
    };
    return YAML.stringify(out, undefined, 4);
  }

  // /**
  //  *
  //  * @param noteOrPath
  //  * @param schemas
  //  * @param opts
  //  *   - matchNamespace: should match exact namespace note (in addition to wildcard), default: false
  //  *   - matchPrefix: allow prefix match, default: false
  //  */
  // static match(
  //   noteOrPath: NotePropsV2| string,
  //   schemas: SchemaModuleV2[],
  //   opts?: { matchNamespace?: boolean; matchPrefix?: boolean }
  // ): SchemaPropsV2 {
  //   const cleanOpts = _.defaults(opts, {
  //     matchNamespace: true,
  //     matchPrefix: false,
  //   });
  //   const notePath = _.isString(noteOrPath) ? noteOrPath : noteOrPath.fname;
  //   const notePathClean = notePath.replace(/\./g, "/");
  //   let match: SchemaPropsV2| undefined;
  //   _.find(schemas, (schemaMod) => {
  //     let schemasToMatch = schemaMod.schemas;
  //     return _.some(schemaDomain.nodes, (schema) => {
  //       const patternMatch = schema.patternMatch;
  //       if (
  //         (schema as SchemaPropsV2).data.namespace &&
  //         cleanOpts.matchNamespace
  //       ) {
  //         if (minimatch(notePathClean, _.trimEnd(patternMatch, "/*"))) {
  //           match = schema;
  //           return true;
  //         }
  //       }
  //       if (minimatch(notePathClean, patternMatch)) {
  //         match = schema;
  //         return true;
  //       } else {
  //         return false;
  //       }
  //     });
  //   });
  //   if (_.isUndefined(match)) {
  //     throw Error("not implemented");
  //   }
  //   return match;
  // }
}