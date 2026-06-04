// Privacy Policy page
export const metadata = {
	title: 'Política de Privacidad - CambioCUP',
	description: 'Política de privacidad de CambioCUP: no recopilamos ni almacenamos datos personales de los visitantes.',
}

export default function Privacy() {
	return (
		<div className="bg-malachite h-screen flex flex-col justify-center items-center">
			<h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
			<div className="text-center p-4 leading-7">
				<p>We are committed to protecting your privacy. This privacy policy outlines our practices concerning the non-collection of data.</p>
				<p className="mt-4">Data We Do Not Collect:</p>
				<ul className="list-disc list-inside">
					<li>Personal Identifiable Information</li>
					<li>Location Data</li>
					<li>Usage Data</li>
					<li>Cookies and Tracking Data</li>
				</ul>
				<p className="mt-4">
					We do not store or process any personal data through this website. Our website is designed to provide information without the need to collect personal information from its visitors.
				</p>
				<p className="mt-4">
					Third-Party Services: We do not share any data with third-party services, nor do we use third-party services that collect information on our behalf.
				</p>
				<p className="mt-4">
					Changes to This Policy: We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page.
				</p>
				<p className="mt-4">
					If you have any questions about this Privacy Policy, please contact us.
				</p>
			</div>
		</div>
	)
}
