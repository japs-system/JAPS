const { Sequelize } = require("sequelize");

const useSsl = process.env.DB_SSL === "true";

const sequelize = new Sequelize(
	process.env.DB_NAME,
	process.env.DB_USER,
	process.env.DB_PASSWORD,
	{
		host: process.env.DB_HOST || "localhost",
		port: process.env.DB_PORT || 5432,
		dialect: "postgres",
		logging: false,
		dialectOptions: useSsl
			? {
					ssl: {
						require: true,
						rejectUnauthorized: false,
					},
				}
			: {},
	},
);

module.exports = sequelize;
