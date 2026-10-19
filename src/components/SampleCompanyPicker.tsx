import { listCompanies } from '../data/mock-company-index'

export function SampleCompanyPicker() {
  const companies = listCompanies()
  const owner = companies.find((company) => company.org.ownerOrg)
  const samples = companies.filter((company) => !company.org.ownerOrg)
  return (
    <section className="sample-picker" aria-labelledby="sample-companies-title" data-testid="org-picker">
      <div className="screen-title">
        <h2 id="sample-companies-title">Organizations</h2>
        <p>Open a chart. Work is the default view. No sign-in.</p>
      </div>
      {owner ? <OrgCard company={owner} owner /> : null}
      <p className="picker-kicker">Sample orgs to explore</p>
      <ul className="sample-grid">
        {samples.map((company) => (
          <li key={company.org.id}>
            <OrgCard company={company} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function OrgCard({
  company,
  owner = false,
}: {
  company: ReturnType<typeof listCompanies>[number]
  owner?: boolean
}) {
  const humans = company.seats.filter((seat) => seat.type === 'human').length
  const bots = company.seats.filter((seat) => seat.type === 'bot' && seat.status !== 'retired').length
  return (
    <a className="card sample-card" href={`#sample/${company.org.id}`}>
      <span className="sample-card-top">
        <span className="org-mark" aria-hidden="true">
          {company.org.mark}
        </span>
        <span className="pc-label">{owner ? "Owner's org" : company.org.industry}</span>
      </span>
      <h3>{company.org.name}</h3>
      <p>{company.org.tagline || company.org.description}</p>
      <p className="org-counts">
        {company.org.industry} · {humans} {humans === 1 ? 'human' : 'humans'} · {bots} {bots === 1 ? 'bot' : 'bots'}
      </p>
    </a>
  )
}
