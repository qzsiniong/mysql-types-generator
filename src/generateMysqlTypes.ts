import * as fs from 'fs';
import * as mysql from 'mysql2/promise';

import { getColumnDataType } from './getColumnDataType';

export type GenerateMysqlTypesConfig = {
  db: {
    host: string;
    port?: number;
    user: string;
    password: string;
    database: string;
  };
  output: {
    path: string;
  };
  suffix?: string;
  ignoreTables?: string[];
};

export const generateMysqlTypes = async (config: GenerateMysqlTypesConfig) => {
  // connect to db
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port || 3306,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });

  // get all tables
  let [tables] = (await connection.execute(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = '?'`,
    [config.db.database],
  )) as any;

  // filter default ignored tables
  tables = tables
    .map((table: { TABLE_NAME: string }) => table.TABLE_NAME)
    .filter((tableName: string) => !tableName.includes('knex_'));

  // filter ignored tables
  if (config.ignoreTables && config.ignoreTables.length > 0) {
    tables = tables.filter((tableName: string) => !config.ignoreTables!.includes(tableName));
  }

  // check if at least one table exists
  if (tables.length === 0) {
    return;
  }

  // create empty output directory
  if (fs.existsSync(config.output.path)) {
    fs.rmSync(config.output.path, { recursive: true });
  }
  fs.mkdirSync(config.output.path);

  // start making the index file
  const indexFileStream = fs.createWriteStream(`${config.output.path}/index.ts`, 'utf-8');

  // loop through each table
  for (const table of tables) {
    // convert table names from snake case to camel case
    const typeName = `${table
      .split('_')
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('')}${config.suffix || ''}`;

    // get the columns
    const [columns] = (await connection.execute(
      `SELECT column_name, data_type, column_type FROM information_schema.columns WHERE table_schema = '?' and table_name = '?'`,
      [config.db.database, table],
    )) as any;

    // create type file stream
    const outputTypeFileStream = fs.createWriteStream(`${config.output.path}/${typeName}.ts`, 'utf-8');
    outputTypeFileStream.write(`export type ${typeName} = {\n`);

    // output the columns and types
    columns.forEach((column: { COLUMN_NAME: string; DATA_TYPE: string; COLUMN_TYPE: string }) => {
      outputTypeFileStream.write(
        `  ${column.COLUMN_NAME}: ${getColumnDataType(column.DATA_TYPE, column.COLUMN_TYPE)};\n`,
      );
    });
    outputTypeFileStream.write('}\n');

    // write the type file
    outputTypeFileStream.end();

    // add type to index file
    indexFileStream.write(`export type { ${typeName} } from './${typeName}'\n`);
  }

  // write the index file
  indexFileStream.write('\n');
  indexFileStream.end();
};