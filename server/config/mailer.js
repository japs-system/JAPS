const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
	service: "gmail",
	auth: {
		user: process.env.SMTP_USER,
		pass: process.env.SMTP_APP_PASSWORD,
	},
});

const BRAND_BLUE = "#1E5AAA";
// The logo is loaded from the website, not attached to every email — the Gmail
// phone app often fails to show embedded (cid) images and lists them as attachments.
// The file is client/public/assets/images/JAPS (white).png — its name is URL-encoded below
// (space = %20, brackets = %28 %29) because a web address can't contain them as-is.
const SITE_URL = () => process.env.CLIENT_URL || "http://localhost:2736";
const LOGO_URL = () => `${SITE_URL()}/assets/images/JAPS%20%28white%29.png`;
const LOGIN_URL = () => process.env.CLIENT_URL || "http://localhost:2736";

const peso = (n) => `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

// Shared row/table renderers so every email reads like one system.
const row = (label, value) => `
	<tr>
		<td style="padding:10px 0;color:#6b7280;border-bottom:1px solid #e5e7eb;">${label}</td>
		<td style="padding:10px 0;color:#111827;font-weight:600;text-align:right;border-bottom:1px solid #e5e7eb;">${value}</td>
	</tr>`;

const renderEmail = ({ heading, intro, tableRows, note, ctaLabel, ctaUrl }) => `
	<div style="background-color:#f3f4f6;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
		<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
			<div style="background-color:${BRAND_BLUE};padding:24px;text-align:center;">
				<img src="${LOGO_URL()}" alt="JAPS" height="32" style="height:32px;width:auto;border:0;outline:none;" />
			</div>
			<div style="padding:32px;">
				<h1 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 8px;">${heading}</h1>
				<p style="font-size:14px;color:#6b7280;margin:0 0 24px;line-height:1.5;">${intro}</p>
				${tableRows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;">${tableRows}</table>` : ""}
				${
					ctaUrl
						? `<a href="${ctaUrl}" style="display:block;text-align:center;background-color:${BRAND_BLUE};color:#ffffff;font-weight:600;font-size:14px;padding:12px;border-radius:8px;text-decoration:none;margin:28px 0 8px;">${ctaLabel}</a>`
						: ""
				}
				${note ? `<p style="font-size:12px;color:#9ca3af;margin:16px 0 0;line-height:1.5;">${note}</p>` : ""}
			</div>
			<p style="text-align:center;color:#d1d5db;font-size:11px;margin:16px 0;">© ${new Date().getFullYear()} JAPS. All rights reserved.</p>
		</div>
	</div>`;

const send = (to, subject, html) =>
	transporter.sendMail({
		from: process.env.SMTP_FROM || process.env.SMTP_USER,
		to,
		subject,
		html,
	});

const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ");

const sendAccountCredentialsEmail = async ({ to, employee_id, username, password, role }) => {
	const html = renderEmail({
		heading: "Welcome to JAPS",
		intro: "An account has been created for you. Use the credentials below to sign in.",
		tableRows:
			row("Employee ID", employee_id) +
			row("Username", username) +
			row("Password", password) +
			row("Role", role.replace("_", " ")),
		note: "For security, please log in and change your password as soon as possible.",
		ctaLabel: "Sign In",
		ctaUrl: LOGIN_URL(),
	});
	await send(to, "Your JAPS account has been created", html);
};

// Notify a driver/conductor that a new trip has been scheduled for them.
const sendTripScheduledEmail = async ({
	to,
	name,
	tripNumber,
	busLabel,
	routeLabel,
	departureTime,
}) => {
	const html = renderEmail({
		heading: "New Trip Scheduled",
		intro: `Hi ${name}, a new trip has been added to your schedule.`,
		tableRows:
			row("Trip #", tripNumber) +
			row("Bus", busLabel) +
			row("Route", routeLabel) +
			row(
				"Departure",
				new Date(departureTime).toLocaleString("en-PH", {
					dateStyle: "medium",
					timeStyle: "short",
				}),
			),
		ctaLabel: "View Schedule",
		ctaUrl: LOGIN_URL(),
	});
	await send(to, "New trip scheduled — JAPS", html);
};

// Notify a driver/conductor of a batch of trips scheduled for one day.
const sendTripsScheduledSummaryEmail = async ({ to, name, busLabel, date, trips }) => {
	const tripRows = trips
		.map((t) =>
			row(
				`Trip #${t.tripNumber} (${t.routeLabel})`,
				new Date(t.departureTime).toLocaleString("en-PH", {
					dateStyle: "medium",
					timeStyle: "short",
				}),
			),
		)
		.join("");
	const html = renderEmail({
		heading: "New Trips Scheduled",
		intro: `Hi ${name}, ${trips.length} trip${trips.length > 1 ? "s have" : " has"} been added to your schedule for ${new Date(date).toLocaleDateString("en-PH", { dateStyle: "medium" })} on bus ${busLabel}.`,
		tableRows: tripRows,
		ctaLabel: "View Schedule",
		ctaUrl: LOGIN_URL(),
	});
	await send(to, "New trips scheduled — JAPS", html);
};

// Notify owner-level staff (owner/secretary/admin staff) of trips scheduled for a crew.
const sendTripsScheduledManagementEmail = async ({
	to,
	name,
	busLabel,
	date,
	driverName,
	conductorName,
	trips,
}) => {
	const tripRows = trips
		.map((t) =>
			row(
				`Trip #${t.tripNumber} (${t.routeLabel})`,
				new Date(t.departureTime).toLocaleString("en-PH", {
					dateStyle: "medium",
					timeStyle: "short",
				}),
			),
		)
		.join("");
	const html = renderEmail({
		heading: "Trip Schedule Notice",
		intro: `Good Day, ${trips.length} trip${trips.length > 1 ? "s have" : " has"} been scheduled on bus ${busLabel} for ${new Date(date).toLocaleDateString("en-PH", { dateStyle: "medium" })}.`,
		tableRows: row("Driver", driverName) + row("Conductor", conductorName) + tripRows,
		ctaLabel: "View Schedules",
		ctaUrl: LOGIN_URL(),
	});
	await send(to, `Trip schedule notice — Bus ${busLabel}`, html);
};

// Notify a driver/conductor that they've been assigned/unassigned to a bus.
const sendCrewAssignmentEmail = async ({ to, name, role, busLabel, assigned }) => {
	const html = renderEmail({
		heading: assigned ? "Bus Assignment" : "Bus Unassignment",
		intro: assigned
			? `Hi ${name}, you have been assigned as ${role} for the bus below.`
			: `Hi ${name}, you have been unassigned as ${role} from the bus below.`,
		tableRows: row("Bus", busLabel) + row("Role", role),
		ctaLabel: "View Details",
		ctaUrl: LOGIN_URL(),
	});
	await send(to, assigned ? "Bus assignment — JAPS" : "Bus unassignment — JAPS", html);
};

// Notify the driver/conductor of a remittance's approval/rejection outcome.
const sendRemittanceStatusEmail = async ({ to, name, status, date, busLabel, reason }) => {
	const approved = status === "approved";
	const html = renderEmail({
		heading: approved ? "Remittance Approved" : "Remittance Rejected",
		intro: `Hi ${name}, your remittance for the trip below has been ${status}.`,
		tableRows:
			row("Bus", busLabel) +
			row("Date", new Date(date).toLocaleDateString("en-PH", { dateStyle: "medium" })) +
			(reason ? row("Reason", reason) : ""),
		note: approved
			? undefined
			: "Please review the remarks above, correct the entries, and resubmit for review.",
		ctaLabel: approved ? "View Remittance" : "Resubmit Remittance",
		ctaUrl: LOGIN_URL(),
	});
	await send(to, approved ? "Remittance approved — JAPS" : "Remittance rejected — JAPS", html);
};

// Notify audit tellers/owner that a remittance was (re)submitted for review.
const sendRemittanceSubmittedEmail = async ({
	to,
	conductorName,
	busLabel,
	date,
	netCollection,
	isResubmission,
}) => {
	const html = renderEmail({
		heading: isResubmission ? "Remittance Resubmitted" : "Remittance Submitted",
		intro: `${conductorName} has ${isResubmission ? "resubmitted" : "submitted"} a remittance awaiting your review.`,
		tableRows:
			row("Bus", busLabel) +
			row("Date", new Date(date).toLocaleDateString("en-PH", { dateStyle: "medium" })) +
			row("Net Collection", peso(netCollection)),
		ctaLabel: "Review Remittance",
		ctaUrl: LOGIN_URL(),
	});
	await send(
		to,
		isResubmission ? "Remittance resubmitted for review — JAPS" : "New remittance for review — JAPS",
		html,
	);
};

// Confirm to the conductor that their remittance was (re)submitted, with a summary of it.
const sendRemittanceReceiptEmail = async ({ to, name, busLabel, remittance, isResubmission }) => {
	const html = renderEmail({
		heading: isResubmission
			? "Remittance Resubmitted Successfully"
			: "Remittance Submitted Successfully",
		intro: `Hi ${name}, your remittance was successfully ${isResubmission ? "updated and resubmitted" : "submitted"} and is now awaiting review by the audit teller. Here is a summary of what you sent.`,
		tableRows:
			row("Bus", busLabel) +
			row("Date", new Date(remittance.date).toLocaleDateString("en-PH", { dateStyle: "medium" })) +
			row("No. of Trips", remittance.no_of_trips) +
			row("Gross Income", peso(remittance.gross_income)) +
			row("Total Expenses", peso(remittance.total_expenses)) +
			row("Net Gross", peso(remittance.net_gross)) +
			row("Driver Commission", peso(remittance.driver_commission)) +
			row("Conductor Commission", peso(remittance.conductor_commission)) +
			row("Bonus / Allowance", peso(remittance.bonus_allowance)) +
			row("Other Deductions", peso(remittance.other_deductions)) +
			row("Cash Deposit", peso(remittance.cash_deposit)) +
			row("Net Collection", peso(remittance.net_collection)),
		note: "You will receive another email once the audit teller approves or rejects this remittance.",
		ctaLabel: "View Remittance",
		ctaUrl: LOGIN_URL(),
	});
	await send(
		to,
		isResubmission
			? "Remittance resubmitted successfully — JAPS"
			: "Remittance submitted successfully — JAPS",
		html,
	);
};

module.exports = {
	fullName,
	sendAccountCredentialsEmail,
	sendTripScheduledEmail,
	sendTripsScheduledSummaryEmail,
	sendTripsScheduledManagementEmail,
	sendCrewAssignmentEmail,
	sendRemittanceStatusEmail,
	sendRemittanceSubmittedEmail,
	sendRemittanceReceiptEmail,
};