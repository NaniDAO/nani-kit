import SwiftUI
import UIKit

struct YieldOpportunitiesView: View {
    let wallet: WalletState
    let center: TransactionConfirmationCenter
    @State private var chainID: Int
    @State private var asset = ""
    @State private var stablecoin = false
    @State private var report: SharedYieldTools.Report?
    @State private var busy = false
    @State private var error: String?

    init(wallet: WalletState, center: TransactionConfirmationCenter) {
        self.wallet = wallet; self.center = center
        _chainID = State(initialValue: wallet.selectedChain.id)
    }
    var body: some View {
        Form {
            Section {
                Text("Compare reported rates and liquidity. Returns vary; a listing does not verify a protocol or make a deposit available.")
                Picker("Network", selection: $chainID) {
                    ForEach(PhoneChains.all.filter { [1, 10, 42161, 8453, 4663].contains($0.id) }, id: \.id) { Text($0.name).tag($0.id) }
                }
                TextField("Asset, such as USDC or ETH", text: $asset).textInputAutocapitalization(.characters).autocorrectionDisabled()
                Toggle("Stablecoin pools only", isOn: $stablecoin)
                Button("Find opportunities") { load() }.disabled(busy)
            } footer: { Text("Requests go to DefiLlama through the shared tools. No wallet address is included in yield requests.") }
            .disabled(busy)
            if busy { ProgressView("Reading yield listings…") }
            if let error { Section { Text(error).foregroundStyle(Theme.SemanticInk.warning) } }
            if let report {
                Section {
                    Text("Ordered by reported liquidity. This is a research shortlist, not a safety ranking.")
                    Text("Observed \(report.observedAt)").font(.caption).foregroundStyle(.secondary)
                    if report.yields.isEmpty { Text("No matching listings were returned for this network and filter.") }
                    ForEach(report.yields) { pool in
                        NavigationLink {
                            YieldOpportunityView(pool: pool, observedAt: report.observedAt, chainID: chainID, wallet: wallet, center: center)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(pool.asset).font(.headline)
                                Text(pool.project).font(.subheadline)
                                Text("APY \(pool.apy ?? "unavailable") · Liquidity \(pool.tvlUsd.map { $0.formatted(.currency(code: "USD")) } ?? "unavailable")").font(.caption)
                                Text("Protocol and withdrawal access unverified").font(.caption).foregroundStyle(Theme.SemanticInk.warning)
                            }
                        }
                    }
                }
            }
        }.navigationTitle("Yield opportunities").naniSurface(.instrument)
            .onChange(of: chainID) { _, _ in report = nil; error = nil }
            .onChange(of: asset) { _, _ in report = nil; error = nil }
            .onChange(of: stablecoin) { _, _ in report = nil; error = nil }
    }
    private func load() {
        busy = true; error = nil; report = nil
        let requested = chainID, symbol = asset, stable = stablecoin
        Task {
            defer { busy = false }
            do {
                let fresh = try await SharedYieldTools.discover(chainID: requested, asset: symbol, stablecoin: stable)
                guard chainID == requested, asset == symbol, stablecoin == stable else { return }
                report = fresh
            } catch { self.error = error.localizedDescription }
        }
    }
}

private struct YieldOpportunityView: View {
    let pool: SharedYieldTools.Opportunity
    let observedAt: String
    let chainID: Int
    let wallet: WalletState
    let center: TransactionConfirmationCenter
    @State private var history: SharedYieldTools.History?
    @State private var evidence: SharedYieldTools.PoolEvidence?
    @State private var evidenceError: String?
    @State private var error: String?
    @State private var busy = false
    var body: some View {
        Form {
            Section("Reported opportunity") {
                LabeledContent("Asset", value: pool.asset)
                LabeledContent("Protocol", value: pool.project)
                LabeledContent("Network", value: pool.chain)
                LabeledContent("APY", value: pool.apy ?? "Unavailable")
                LabeledContent("Base APY", value: pool.apyBase ?? "Unavailable")
                LabeledContent("Reward APY", value: pool.apyReward ?? "Unavailable")
            } footer: { Text("Observed \(observedAt). The source does not provide a last-updated time for this listing.") }
            Section("Before deciding") {
                ForEach(pool.warnings, id: \.self) { Text($0).foregroundStyle(Theme.SemanticInk.warning) }
                Text("Net returns are unknown until bridge fees, gas, entry and exit costs are checked for your amount. Deposits and withdrawals for this pool are not verified in this build.")
            }
            Section("30-day history") {
                Button(busy ? "Reading history…" : "Check historical rates") {
                    busy = true; error = nil
                    Task {
                        defer { busy = false }
                        do { history = try await SharedYieldTools.history(pool: pool, chainID: chainID) }
                        catch { self.error = error.localizedDescription; history = nil }
                    }
                }.disabled(busy)
                if let error { Text("History unavailable: " + error).foregroundStyle(Theme.SemanticInk.warning) }
                if let history {
                    LabeledContent("Average APY", value: String(format: "%.2f%%", history.averageApy))
                    LabeledContent("Observed range", value: String(format: "%.2f%% – %.2f%%", history.minApy, history.maxApy))
                    LabeledContent("Observations", value: "\(history.dataPoints)")
                    Text("\(history.firstObservation) to \(history.lastObservation)").font(.caption)
                    if history.missingApyPoints > 0 { Text("\(history.missingApyPoints) observations have no APY.") }
                    ForEach(history.warnings, id: \.self) { Text($0) }
                } else { Text("Historical stability has not been established.") }
            }
            Section("Pool evidence") {
                Button("Check underlying token contracts") {
                    busy = true; evidenceError = nil
                    Task {
                        defer { busy = false }
                        do { evidence = try await SharedYieldTools.evidence(pool: pool, chainID: chainID) }
                        catch { evidence = nil; evidenceError = error.localizedDescription }
                    }
                }.disabled(busy)
                if let evidenceError { Text("Evidence unavailable: " + evidenceError).foregroundStyle(Theme.SemanticInk.warning) }
                if let evidence {
                    Text("Checked at block \(evidence.block) · \(evidence.observedAt)").font(.caption)
                    if evidence.tokenChecks.isEmpty { Text("The source supplied no underlying token contracts.") }
                    ForEach(Array(evidence.tokenChecks.enumerated()), id: \.offset) { _, check in
                        VStack(alignment: .leading) {
                            Text(check.token ?? "Unknown token").textSelection(.enabled)
                            Text(check.codePresent.map { $0 ? "Contract code found" : "No contract code found" } ?? "Contract read unavailable")
                        }
                    }
                    if !evidence.complete { Text("Token evidence is partial. Unchecked tokens: \(evidence.uncheckedTokens).") }
                    Text(evidence.warning).foregroundStyle(Theme.SemanticInk.warning)
                }

                DisclosureGroup("Source identifiers") {
                    Text(pool.pool).textSelection(.enabled)
                    Button("Copy pool ID", systemImage: "doc.on.doc") { UIPasteboard.general.string = pool.pool }
                    Text("This is a DefiLlama pool identifier, not a verified contract address.")
                    if let tokens = pool.underlyingTokens {
                        ForEach(tokens, id: \.self) { token in
                            Text(token).textSelection(.enabled)
                            Button("Copy token value", systemImage: "doc.on.doc") { UIPasteboard.general.string = token }
                        }
                    }
                }
            }
            if wallet.selectedChain.id != chainID, AcrossClient.isSupported(chainID: wallet.selectedChain.id), AcrossClient.isSupported(chainID: chainID) {
                Section {
                    NavigationLink("Review a bridge to \(pool.chain)") { BridgeView(wallet: wallet, center: center, destinationChainID: chainID) }
                } footer: { Text("Choose a verified bridge asset and amount. Moving funds does not deposit into this pool. Confirm arrival before reviewing any separate action.") }
            }
        }.navigationTitle(pool.asset).naniSurface(.instrument)
    }
}
