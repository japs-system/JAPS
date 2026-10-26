const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
	const User = sequelize.define(
		"User",
		{
			id: {
				type: DataTypes.INTEGER,
				primaryKey: true,
				autoIncrement: true,
			},
			employee_id: {
				type: DataTypes.STRING,
				allowNull: false,
				unique: true,
			},
			username: {
				type: DataTypes.STRING,
				allowNull: false,
				unique: true,
			},
			password: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			role: {
				type: DataTypes.ENUM(
					"owner",
					"secretary",
					"admin_staff",
					"audit_teller",
					"conductor",
					"driver",
				),
				allowNull: false,
			},
			first_name: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			middle_name: {
				type: DataTypes.STRING,
				allowNull: true,
			},
			last_name: {
				type: DataTypes.STRING,
				allowNull: false,
			},
			suffix: {
				type: DataTypes.ENUM("Jr.", "Sr.", "I", "II", "III", "IV", "V"),
				allowNull: true,
			},
			email: {
				type: DataTypes.STRING,
				allowNull: false,
				unique: true,
			},
			contact_number: {
				type: DataTypes.STRING,
				allowNull: true,
			},
			is_active: {
				type: DataTypes.BOOLEAN,
				defaultValue: true,
			},
		},
		{
			tableName: "users",
			timestamps: true,
			underscored: true,
		},
	);

	return User;
};
